'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');
const { parseSql }           = require('./sqlParser');
const { validateContracts }  = require('./driftValidator');
const { globSync }           = require('../utils/glob');
const { ToolkitError }       = require('../errors');

const DEFAULT_CONFIG = 'docs/contracts/ui-governance.config.json';

/**
 * Load and validate the governance config file.
 * @param {string} configPath
 * @returns {{ dbSchema: string, views: string, rules: object[] }}
 */
function loadConfig(configPath) {
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    throw new ToolkitError(
      `Governance config not found: ${absPath}\n` +
      `Create it or pass --config <path>.`,
      4
    );
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  } catch (e) {
    throw new ToolkitError(`Failed to parse governance config '${absPath}': ${e.message}`, 4);
  }
}

/**
 * `ui-schema audit` command implementation.
 *
 * @param {{ config?: string, views?: string, dbSchema?: string }} opts
 * @param {string[]} positionals - Additional contract file paths (override glob)
 */
async function runAudit(opts, positionals) {
  const configPath = opts.config || DEFAULT_CONFIG;
  const cfg = loadConfig(configPath);

  // Resolve DB schema path
  const dbSchemaPath = path.resolve(opts.dbSchema || cfg.dbSchema);
  if (!fs.existsSync(dbSchemaPath)) {
    throw new ToolkitError(`DB schema file not found: ${dbSchemaPath}`, 4);
  }

  // Parse DB schema
  process.stderr.write(`[ui-schema audit] parsing DB schema: ${dbSchemaPath}\n`);
  const tables = parseSql(dbSchemaPath);
  process.stderr.write(`  found ${tables.size} table(s)\n`);

  // Resolve contract files
  const viewsGlob = opts.views || cfg.views;
  let files = positionals && positionals.length > 0
    ? positionals
    : globSync(viewsGlob);

  if (files.length === 0) {
    process.stderr.write(`[ui-schema audit] no contract files matched glob: ${viewsGlob}\n`);
    process.stderr.write('  Nothing to audit.\n');
    return;
  }

  process.stderr.write(`[ui-schema audit] auditing ${files.length} contract(s) against ${tables.size} table(s)\n\n`);

  // Load contracts
  const contracts = [];
  for (const file of files) {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      process.stderr.write(`  ✗ ${file}: not found\n`);
      continue;
    }
    try {
      const doc = parse(fs.readFileSync(absPath, 'utf-8'));
      contracts.push({ filePath: file, doc });
    } catch (e) {
      process.stderr.write(`  ✗ ${file}: YAML parse error — ${e.message}\n`);
    }
  }

  // Run validation
  const violations = validateContracts(tables, contracts, cfg.rules);

  if (violations.length === 0) {
    process.stdout.write(`\n[ui-schema audit] ✓ all ${contracts.length} contract(s) pass governance.\n`);
    return;
  }

  // Report violations
  process.stderr.write(`\n[ui-schema audit] ${violations.length} violation(s) found:\n\n`);
  for (const v of violations) {
    process.stderr.write(`  [${v.rule}] ${v.file}\n`);
    process.stderr.write(`    field: ${v.field}\n`);
    process.stderr.write(`    ${v.message}\n\n`);
  }

  throw new ToolkitError(
    `Governance audit failed: ${violations.length} violation(s) in ${contracts.length} contract(s).`,
    1
  );
}

module.exports = { runAudit };
