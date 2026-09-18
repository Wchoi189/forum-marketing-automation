'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');
const { ToolkitError } = require('./errors');

const SCHEMA_PATH = path.join(__dirname, '../schemas/ui-schema.v1.schema.json');

/**
 * Minimal hand-rolled JSON Schema (draft-07 subset) validator.
 * Supports: type, required, enum, additionalProperties, properties (recursive).
 * Returns array of error message strings (empty = valid).
 *
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [jsonPath]
 * @returns {string[]}
 */
function validate(value, schema, jsonPath = '#') {
  const errors = [];

  if (schema.type) {
    const expected = schema.type;
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actual !== expected) {
      errors.push(`${jsonPath}: expected type '${expected}', got '${actual}'`);
      return errors; // No point continuing if type is wrong
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push(`${jsonPath}: value '${value}' not in enum [${schema.enum.join(', ')}]`);
    }
  }

  if (schema.type === 'object' && value !== null && typeof value === 'object') {
    // Required fields
    for (const req of (schema.required || [])) {
      if (!(req in value)) {
        errors.push(`${jsonPath}: missing required property '${req}'`);
      }
    }

    // Additional properties
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          errors.push(`${jsonPath}: unexpected additional property '${key}'`);
        }
      }
    }

    // Recurse into properties
    if (schema.properties) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...validate(value[key], childSchema, `${jsonPath}.${key}`));
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validate(item, schema.items, `${jsonPath}[${i}]`));
      });
    }
  }

  return errors;
}

/**
 * `ui-schema validate` command implementation.
 *
 * @param {object} opts
 * @param {string[]} positionals - File paths to validate
 */
async function runValidate(opts, positionals) {
  const rootSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));

  let files = positionals;
  if (files.length === 0) {
    // Try config
    const configPath = opts.config || 'docs/contracts/ui-governance.config.json';
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.views) {
        const { globSync } = require('./utils/glob');
        files = globSync(cfg.views);
      }
    }
  }

  if (files.length === 0) {
    throw new ToolkitError('No files to validate. Pass files as arguments or set views glob in config.', 4);
  }

  let totalErrors = 0;

  for (const file of files) {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      process.stderr.write(`  ✗ ${file}: file not found\n`);
      totalErrors++;
      continue;
    }

    let doc;
    try {
      doc = parse(fs.readFileSync(absPath, 'utf-8'));
    } catch (e) {
      process.stderr.write(`  ✗ ${file}: YAML parse error — ${e.message}\n`);
      totalErrors++;
      continue;
    }

    const errors = validate(doc, rootSchema);
    if (errors.length === 0) {
      process.stdout.write(`  ✓ ${file}\n`);
    } else {
      process.stderr.write(`  ✗ ${file}: ${errors.length} violation(s)\n`);
      errors.forEach(e => process.stderr.write(`      ${e}\n`));
      totalErrors += errors.length;
    }
  }

  if (totalErrors > 0) {
    throw new ToolkitError(`Validation failed: ${totalErrors} violation(s) across ${files.length} file(s).`, 1);
  }

  process.stdout.write(`\n[ui-schema validate] all ${files.length} file(s) valid.\n`);
}

module.exports = { runValidate, validate };
