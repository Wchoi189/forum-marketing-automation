#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { EXIT, ToolkitError } = require('../core/errors');

const DEFAULT_CONFIG = 'docs/architecture/arch-governance.config.json';
const COMMANDS = ['validate', 'docify', 'diff'];
const DIFF_FORMATS = ['summary', 'json', 'markdown'];

// Command options: name -> { key, takesValue }. Global options are handled in parseArgs.
// The same flag may mean different things per command (`-a`), so options are resolved only once
// the command is known; `takesValue` must agree across commands, because it decides how argv is read.
const COMMAND_OPTIONS = {
  validate: {
    '--strict': { key: 'strict', takesValue: false },
    '-a': { key: 'architecture', takesValue: true },
    '--architecture': { key: 'architecture', takesValue: true },
    '-p': { key: 'patterns', takesValue: true },
    '--patterns': { key: 'patterns', takesValue: true },
  },
  diff: {
    '-a': { key: 'base', takesValue: true },
    '--base': { key: 'base', takesValue: true },
    '-b': { key: 'proposed', takesValue: true },
    '--proposed': { key: 'proposed', takesValue: true },
    '-f': { key: 'format', takesValue: true },
    '--format': { key: 'format', takesValue: true },
    '--exit-code': { key: 'exitCode', takesValue: false },
  },
  docify: {
    '-a': { key: 'architecture', takesValue: true },
    '--architecture': { key: 'architecture', takesValue: true },
    '-o': { key: 'output', takesValue: true },
    '--output': { key: 'output', takesValue: true },
    '--base-url': { key: 'baseUrl', takesValue: true },
    '--build': { key: 'build', takesValue: false },
  },
};
const TAKES_VALUE = {};
for (const options of Object.values(COMMAND_OPTIONS)) {
  for (const [flag, spec] of Object.entries(options)) TAKES_VALUE[flag] = spec.takesValue;
}

const USAGE = `usage: arch-governance <command> [options]

commands:
  validate [--strict] [-a <arch>] [-p <patternsDir>]
  docify   [--build] [--base-url <url>] [-o <dir>] [-a <arch>]
  diff     -b <candidate> [-a <baseline>] [-f summary|json|markdown] [--exit-code]

global options:
  -c, --config <path>   toolkit config (default ${DEFAULT_CONFIG})
  --json                result object on stdout, human text on stderr (validate)
  -h, --help            this text`;

function usageError(message) {
  return new ToolkitError(`${message}\n\n${USAGE}`, EXIT.USAGE);
}

function parseArgs(argv) {
  const parsed = { config: DEFAULT_CONFIG, json: false, help: false, command: null, options: {} };
  const seen = [];
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) throw usageError(`option ${arg} requires a value`);
      i += 1;
      return next;
    };
    const noValue = () => {
      if (inline !== undefined) throw usageError(`option ${arg} takes no value`);
    };

    if (arg === '-c' || arg === '--config') {
      parsed.config = value();
    } else if (arg === '--json') {
      noValue();
      parsed.json = true;
    } else if (arg === '-h' || arg === '--help') {
      noValue();
      parsed.help = true;
    } else if (arg in TAKES_VALUE) {
      if (TAKES_VALUE[arg]) {
        seen.push([arg, value()]);
      } else {
        noValue();
        seen.push([arg, true]);
      }
    } else if (arg.startsWith('-')) throw usageError(`unknown option ${arg}`);
    else if (parsed.command === null) parsed.command = arg;
    else throw usageError(`unexpected argument ${arg}`);
  }

  if (parsed.help) return parsed;
  if (parsed.command === null) throw usageError('no command given');
  if (!COMMANDS.includes(parsed.command)) throw usageError(`unknown command ${parsed.command}`);
  const allowed = COMMAND_OPTIONS[parsed.command] || {};
  for (const [arg, optionValue] of seen) {
    if (!(arg in allowed)) throw usageError(`option ${arg} does not apply to ${parsed.command}`);
    parsed.options[allowed[arg].key] = optionValue;
  }
  return parsed;
}

function requirePath(relative, kind, flag) {
  let stat;
  try {
    stat = fs.statSync(path.resolve(relative));
  } catch {
    throw usageError(`${flag} "${relative}" does not exist`);
  }
  if (kind === 'dir' ? !stat.isDirectory() : !stat.isFile()) {
    throw usageError(`${flag} "${relative}" is not a ${kind === 'dir' ? 'directory' : 'file'}`);
  }
}

function validate(parsed) {
  // Lazy requires: `core/` is loaded only after argv parsed, so usage errors never touch dependencies.
  const { assertDependencies } = require('../core/calmRunner');
  const { loadConfig } = require('../core/config');
  const { runValidate, formatStages } = require('../core/validate');

  assertDependencies();
  // checks/ loads fast-glob, so it is required only once dependencies are known to be installed.
  const { runGuardrails } = require('../checks');
  const config = loadConfig(parsed.config);
  const architecture = parsed.options.architecture ?? config.architecture;
  const patternsDir = parsed.options.patterns ?? config.patternsDir;
  if (parsed.options.architecture) requirePath(architecture, 'file', '--architecture');
  if (parsed.options.patterns) requirePath(patternsDir, 'dir', '--patterns');

  const result = runValidate({ config, architecture, patternsDir, strict: Boolean(parsed.options.strict), guardrails: runGuardrails });
  process.stderr.write(`${formatStages(result.stages)}\n`);
  if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.exitCode;
}

function diff(parsed) {
  if (parsed.json) throw usageError('--json does not apply to diff; use --format json');
  const { proposed, exitCode: passExitCode } = parsed.options;
  if (proposed === undefined) throw usageError('diff requires -b <candidate>');
  const format = parsed.options.format ?? 'summary';
  if (!DIFF_FORMATS.includes(format)) throw usageError(`--format must be one of ${DIFF_FORMATS.join(', ')}`);

  const { assertDependencies, runCalm } = require('../core/calmRunner');
  const { calmStage, formatStages } = require('../core/validate');
  const { render } = require('../core/diffMarkdown');

  assertDependencies();
  // The config is read only for the default baseline; an explicit -a needs no config file.
  const base = parsed.options.base ?? require('../core/config').loadConfig(parsed.config).architecture;
  requirePath(base, 'file', '--base');
  requirePath(proposed, 'file', '--proposed');

  // An invalid candidate exits 1 before any diff is printed.
  const check = calmStage('calm schema', path.basename(proposed), runCalm(['validate', '-a', proposed, '--strict']));
  if (!check.ok) {
    process.stderr.write(`${formatStages([check])}\n`);
    return EXIT.CALM;
  }

  const args = ['diff', '-a', base, '-b', proposed, '-f', format === 'markdown' ? 'json' : format];
  if (passExitCode) args.push('--exit-code');
  const result = runCalm(args);
  // With --exit-code CALM exits 1 when changes exist and still prints the diff.
  const changed = passExitCode && result.exitCode === 1;
  if (result.exitCode !== 0 && !changed) {
    process.stderr.write(`${result.stderr}\ncalm diff exited ${result.exitCode}\n`);
    return EXIT.CALM;
  }

  if (format !== 'markdown') {
    process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    return result.exitCode;
  }
  let diffJson;
  try {
    diffJson = JSON.parse(result.stdout);
  } catch (error) {
    process.stderr.write(`calm diff output was not JSON (${error.message})\n`);
    return EXIT.CALM;
  }
  process.stdout.write(`${render(diffJson, base, proposed)}\n`);
  return result.exitCode;
}

function docify(parsed) {
  if (parsed.json) throw usageError('--json does not apply to docify');
  const baseUrlOption = parsed.options.baseUrl;
  if (baseUrlOption !== undefined && !(baseUrlOption.startsWith('/') && baseUrlOption.endsWith('/'))) {
    throw usageError(`--base-url "${baseUrlOption}" must start and end with "/"`);
  }

  const { assertDependencies } = require('../core/calmRunner');
  const { loadConfig } = require('../core/config');
  const { runDocify } = require('../core/docify');

  assertDependencies();
  const config = loadConfig(parsed.config);
  const architecture = parsed.options.architecture ?? config.architecture;
  if (parsed.options.architecture) requirePath(architecture, 'file', '--architecture');

  return runDocify({
    architecture,
    outputDir: parsed.options.output ?? config.outputDir,
    baseUrl: baseUrlOption ?? config.docsBaseUrl,
    build: Boolean(parsed.options.build),
  });
}

const HANDLERS = { validate, docify, diff };

function main(argv) {
  let parsed = { json: argv.includes('--json'), command: null };
  try {
    parsed = parseArgs(argv);
    if (parsed.help) {
      process.stderr.write(`${USAGE}\n`);
      return EXIT.OK;
    }
    return HANDLERS[parsed.command](parsed);
  } catch (error) {
    if (!(error instanceof ToolkitError)) throw error;
    process.stderr.write(`arch-governance: ${error.message}\n`);
    if (parsed.json) {
      const firstLine = error.message.split('\n')[0];
      process.stdout.write(`${JSON.stringify({ command: parsed.command, exitCode: error.exitCode, error: firstLine })}\n`);
    }
    return error.exitCode;
  }
}

process.exitCode = main(process.argv.slice(2));
