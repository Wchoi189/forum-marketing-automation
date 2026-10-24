'use strict';

const fs = require('node:fs');

/**
 * @typedef {Object} ColumnDef
 * @property {string}   name
 * @property {string}   type
 * @property {boolean}  notNull     - TRUE if column has NOT NULL without a default value
 * @property {boolean}  hasDefault  - TRUE if column has a DEFAULT clause
 * @property {string[]|null} enumValues - Non-null if a CHECK (col IN (...)) constraint exists
 */

/**
 * @typedef {Object} TableDef
 * @property {string}     name
 * @property {ColumnDef[]} columns
 */

/**
 * Parse a SQLite DDL file and extract table/column metadata.
 *
 * Handles:
 * - CREATE TABLE IF NOT EXISTS <name> (...)
 * - Multi-line column definitions
 * - NOT NULL without DEFAULT → governance-significant
 * - CHECK (<col> IN ('a', 'b', ...)) enum constraints
 *
 * @param {string} sqlOrPath - SQL content string or file path
 * @returns {Map<string, TableDef>} Map of table name → TableDef
 */
function parseSql(sqlOrPath) {
  const sql = fs.existsSync(sqlOrPath) ? fs.readFileSync(sqlOrPath, 'utf-8') : sqlOrPath;

  const tables = new Map();

  // Match each CREATE TABLE block (captures table name + column body)
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([^;]+?)\)\s*;/gi;

  let tableMatch;
  while ((tableMatch = tableRe.exec(sql)) !== null) {
    const tableName   = tableMatch[1];
    const bodyRaw     = tableMatch[2];

    const columns = parseColumns(tableName, bodyRaw);
    tables.set(tableName.toLowerCase(), { name: tableName, columns });
  }

  return tables;
}

/**
 * Parse column definitions from a CREATE TABLE body.
 *
 * @param {string} tableName
 * @param {string} body
 * @returns {ColumnDef[]}
 */
function parseColumns(tableName, body) {
  const columns = [];

  // Split on commas that are NOT inside parentheses (to avoid splitting CHECK(...) constraints)
  const lines = splitColDefs(body);

  // Extract per-table CHECK constraints from INLINE definitions
  // e.g.: billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly'))
  // and FOREIGN KEY / PRIMARY KEY lines are skipped

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip constraint lines: FOREIGN KEY, PRIMARY KEY, UNIQUE, CHECK at start
    if (/^(FOREIGN\s+KEY|PRIMARY\s+KEY|UNIQUE|CHECK)\b/i.test(trimmed)) continue;

    // Match: colName TYPE [NOT NULL] [DEFAULT ...] [CHECK (...)]
    const colMatch = trimmed.match(/^["`]?(\w+)["`]?\s+(\w+)/);
    if (!colMatch) continue;

    const colName  = colMatch[1];
    const colType  = colMatch[2];

    const hasNotNull  = /\bNOT\s+NULL\b/i.test(trimmed);
    const hasDefault  = /\bDEFAULT\b/i.test(trimmed);

    // Check for inline enum: CHECK (colname IN ('a', 'b', ...))
    let enumValues = null;
    const checkMatch = trimmed.match(/CHECK\s*\(\s*\w+\s+IN\s*\(([^)]+)\)\s*\)/i);
    if (checkMatch) {
      enumValues = checkMatch[1]
        .split(',')
        .map(v => v.trim().replace(/^['"]|['"]$/g, ''));
    }

    columns.push({
      name:       colName,
      type:       colType.toUpperCase(),
      notNull:    hasNotNull && !hasDefault,
      hasDefault,
      enumValues,
    });
  }

  return columns;
}

/**
 * Split column definitions on top-level commas (not inside parentheses).
 * @param {string} body
 * @returns {string[]}
 */
function splitColDefs(body) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (const char of body) {
    if (char === '(') { depth++; current += char; }
    else if (char === ')') { depth--; current += char; }
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

module.exports = { parseSql };
