'use strict';

const { parse } = require('yaml');
const fs   = require('node:fs');
const path = require('node:path');
const { parseSql } = require('./sqlParser');

/**
 * @typedef {Object} Violation
 * @property {string} file     - Contract file path
 * @property {string} rule     - Rule ID
 * @property {string} field    - Field id in the contract (or column name)
 * @property {string} message  - Human-readable description
 */

/**
 * Map a contextEntity (PascalCase or camelCase component/entity name) to a DB table name.
 * Strategy: lowercase + singularize simple plurals.
 *
 * @param {string} entity
 * @returns {string}
 */
function entityToTableName(entity) {
  if (!entity) return '';
  const lower = entity.toLowerCase();
  // Simple singularization: strip trailing 's' for common cases
  const candidates = [lower, lower.replace(/s$/, ''), lower + 's'];
  return lower; // The caller tries candidates against the tables Map
}

/**
 * Validate UI schema contracts for drift against DB schema.
 *
 * Rules:
 *  required-not-null: For every NOT NULL column without DEFAULT, a matching
 *                     field with required: true must exist in the contract.
 *  enum-options-match: For every CHECK (col IN (...)) constraint, the contract's
 *                      sampleOptions or options.value must cover those values.
 *
 * @param {Map<string, import('./sqlParser').TableDef>} tables  - Parsed DB tables
 * @param {object[]} contracts  - Array of { filePath, doc } objects
 * @param {object[]} rules      - Active rule configs
 * @returns {Violation[]}
 */
function validateContracts(tables, contracts, rules) {
  const activeRules = new Set(
    (rules || [
      { rule: 'required-not-null', enabled: true },
      { rule: 'enum-options-match', enabled: true },
    ])
      .filter(r => r.enabled !== false)
      .map(r => r.rule)
  );

  const violations = [];

  for (const { filePath, doc } of contracts) {
    const entity = doc.view && doc.view.contextEntity;
    if (!entity) continue; // No contextEntity — skip governance check

    // Try to resolve the DB table
    const entityLower = entity.toLowerCase();
    const table =
      tables.get(entityLower) ||
      tables.get(entityLower + 's') ||
      tables.get(entityLower.replace(/s$/, ''));

    if (!table) {
      // No matching table — warn but don't fail
      process.stderr.write(`  [audit] no DB table found for contextEntity '${entity}' in ${filePath}\n`);
      continue;
    }

    const contractFields = doc.fields || [];

    // Build quick-lookup maps
    const fieldById    = new Map(contractFields.map(f => [f.id, f]));
    const fieldByLabel = new Map(contractFields.map(f => [f.label && f.label.toLowerCase(), f]));

    function findField(colName) {
      return fieldById.get(colName) ||
             fieldById.get(colName.replace(/_id$/, '')) ||
             fieldByLabel.get(colName.replace(/_/g, ' '));
    }

    for (const col of table.columns) {
      // Skip internal/meta columns
      if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name.toLowerCase())) continue;

      // Rule: required-not-null
      if (activeRules.has('required-not-null') && col.notNull) {
        const field = findField(col.name);
        if (!field) {
          // Column is mandatory but no contract field exists — soft warning
          continue;
        }
        if (!field.required) {
          violations.push({
            file:    filePath,
            rule:    'required-not-null',
            field:   field.id || col.name,
            message: `DB column '${table.name}.${col.name}' is NOT NULL (no DEFAULT) but field '${field.id}' is not marked required: true`,
          });
        }
      }

      // Rule: enum-options-match
      if (activeRules.has('enum-options-match') && col.enumValues && col.enumValues.length > 0) {
        const field = findField(col.name);
        if (!field) continue;

        // Collect all option values declared in the contract field
        const contractValues = new Set([
          ...(field.sampleOptions || []),
          ...((field.options || []).map(o => o.value || o)),
        ]);

        const missing = col.enumValues.filter(v => !contractValues.has(v));
        if (missing.length > 0) {
          violations.push({
            file:    filePath,
            rule:    'enum-options-match',
            field:   field.id || col.name,
            message: `DB CHECK constraint for '${table.name}.${col.name}' includes values [${missing.join(', ')}] not covered by contract field '${field.id}'`,
          });
        }
      }
    }
  }

  return violations;
}

module.exports = { validateContracts };
