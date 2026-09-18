#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { EXIT, ToolkitError } = require('../src/errors');

// ── Command registry ──────────────────────────────────────────────────────────
const COMMANDS = {
  extract: {
    description: 'Extract UI schemas from a running app via headless Playwright',
    options: {
      '--url':      { key: 'url',      takesValue: true,  required: true },
      '--routes':   { key: 'routes',   takesValue: true,  required: true },
      '--out':      { key: 'out',      takesValue: true,  required: true },
      '--selector': { key: 'selector', takesValue: true,  required: false },
      '--auth':     { key: 'auth',     takesValue: true,  required: false },
      '--config':   { key: 'config',   takesValue: true,  required: false },
    },
  },
  validate: {
    description: 'Validate *.ui-schema.yaml files against ui-schema.v1.schema.json',
    options: {
      '--config':   { key: 'config',   takesValue: true,  required: false },
    },
    positionals: { min: 0, max: Infinity, name: '[files…]' },
  },
  audit: {
    description: 'Audit UI schema contracts against DB schema for field drift',
    options: {
      '--config':    { key: 'config',    takesValue: true, required: false },
      '--views':     { key: 'views',     takesValue: true, required: false },
      '--db-schema': { key: 'dbSchema',  takesValue: true, required: false },
    },
    positionals: { min: 0, max: Infinity, name: '[files…]' },
  },
  diff: {
    description: 'Diff two UI schema files or directories',
    options: {},
    positionals: { min: 2, max: 2, name: '<a> <b>' },
  },
  prompt: {
    description: 'Format a UI schema contract as an ultra-compact LLM prompt block',
    options: {
      '--view':   { key: 'view',   takesValue: true, required: true },
      '--format': { key: 'format', takesValue: true, required: false },
      '--config': { key: 'config', takesValue: true, required: false },
    },
  },
};

// ── Arg parser ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const [, , command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (!COMMANDS[command]) {
    console.error(`ui-schema: unknown command '${command}'. Run with --help for usage.`);
    process.exit(4);
  }

  const cmdDef = COMMANDS[command];
  const opts = {};
  const positionals = [];
  let i = 0;

  while (i < rest.length) {
    const arg = rest[i];
    const optDef = cmdDef.options[arg];
    if (optDef) {
      if (optDef.takesValue) {
        i++;
        if (i >= rest.length) {
          console.error(`ui-schema: flag '${arg}' requires a value.`);
          process.exit(4);
        }
        opts[optDef.key] = rest[i];
      } else {
        opts[optDef.key] = true;
      }
    } else if (arg.startsWith('--')) {
      console.error(`ui-schema: unknown flag '${arg}' for command '${command}'.`);
      process.exit(4);
    } else {
      positionals.push(arg);
    }
    i++;
  }

  // Required flag check
  for (const [flag, def] of Object.entries(cmdDef.options || {})) {
    if (def.required && !(def.key in opts)) {
      console.error(`ui-schema ${command}: required flag '${flag}' is missing.`);
      process.exit(4);
    }
  }

  return { command, opts, positionals };
}

function printHelp() {
  console.log('Usage: ui-schema <command> [flags]\n');
  console.log('Commands:');
  for (const [name, def] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(12)} ${def.description}`);
  }
  console.log('\nRun `ui-schema <command> --help` for command-specific flags.');
  console.log('\nExit codes: 0=ok  1=violation  3=not-installed  4=config-error');
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
async function main() {
  const { command, opts, positionals } = parseArgs(process.argv);

  try {
    switch (command) {
      case 'extract': {
        const { runExtract } = require('../src/headless/ariaCrawler');
        await runExtract(opts);
        break;
      }
      case 'validate': {
        const { runValidate } = require('../src/schemaValidator');
        await runValidate(opts, positionals);
        break;
      }
      case 'audit': {
        const { runAudit } = require('../src/governance/ruleEngine');
        await runAudit(opts, positionals);
        break;
      }
      case 'diff': {
        console.error('ui-schema diff: not yet implemented.');
        process.exit(4);
        break;
      }
      case 'prompt': {
        const { runPrompt } = require('../src/promptFormatter');
        await runPrompt(opts);
        break;
      }
    }
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('yaml')) {
      console.error(`\n[ui-schema] Missing dependencies. Run 'npm ci --prefix tools/ui-schema-engine'`);
      process.exit(EXIT.NOT_INSTALLED);
    }
    if (err instanceof ToolkitError) {
      console.error(`\n[ui-schema] ${err.message}`);
      process.exit(err.exitCode);
    }
    console.error('\n[ui-schema] Unexpected error:', err);
    process.exit(1);
  }
}

main();
