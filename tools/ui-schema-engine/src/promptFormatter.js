'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');
const { ToolkitError } = require('./errors');

/**
 * `ui-schema prompt` command.
 * Reads an existing *.ui-schema.yaml from the contracts/views directory
 * and re-formats it as an ultra-compact LLM prompt block (<100 tokens).
 *
 * @param {{ view: string, format?: string, config?: string }} opts
 */
async function runPrompt(opts) {
  const viewName = opts.view;
  if (!viewName) {
    throw new ToolkitError('--view <ViewName> is required.', 4);
  }

  // Resolve config to find contracts directory
  const configPath = opts.config || 'docs/contracts/ui-governance.config.json';
  let contractsDir = path.join(path.dirname(configPath), 'views');

  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (cfg.views) {
        // cfg.views is a glob like "specs/078-.../contracts/views/*.ui-schema.yaml"
        // Strip the filename glob part to get the directory
        const globPattern = cfg.views;
        const lastSlash = globPattern.lastIndexOf('/');
        const dirPart = lastSlash >= 0 ? globPattern.slice(0, lastSlash) : '.';
        contractsDir = path.resolve(dirPart);
      }
    } catch { /* ignore */ }
  }

  const candidate = path.join(contractsDir, `${viewName}.ui-schema.yaml`);
  if (!fs.existsSync(candidate)) {
    throw new ToolkitError(
      `Contract not found: ${candidate}\nRun 'ui-schema extract' or hand-author the contract first.`,
      4
    );
  }

  const raw = fs.readFileSync(candidate, 'utf-8');
  const doc = parse(raw);

  // Ultra-compact DSL output
  const view = doc.view || {};
  const lines = [];
  lines.push(`[${(view.type || 'VIEW').toUpperCase()}: "${view.title || viewName}"]`);
  if (view.description) lines.push(`  desc: "${view.description}"`);

  const fields = doc.fields || [];
  if (fields.length > 0) {
    lines.push('  fields:');
    for (const f of fields) {
      const req = f.required ? '*' : '';
      const comp = f.component || f.type || 'input';
      const opts2 = f.sampleOptions ? ` opts:[${f.sampleOptions.slice(0, 3).join(',')}]` : '';
      lines.push(`    - ${f.id || f.name || 'field'}${req} [${comp}] "${f.label || ''}"${opts2}`);
    }
  }

  const actions = doc.actions || [];
  if (actions.length > 0) {
    lines.push('  actions:');
    for (const a of actions) {
      const variant = a.variant ? ` (${a.variant})` : '';
      lines.push(`    - "${a.label || a.id}"${variant}`);
    }
  }

  const output = lines.join('\n');
  process.stdout.write(output + '\n');

  // Token estimate
  const tokens = Math.ceil(output.length / 3.8);
  process.stderr.write(`[ui-schema prompt] ${tokens} estimated tokens\n`);
}

module.exports = { runPrompt };
