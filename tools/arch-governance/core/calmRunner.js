'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EXIT, ToolkitError } = require('./errors');

// The toolkit's own directory, never cwd: the toolkit runs from the host repository's root.
const TOOLKIT_DIR = path.resolve(__dirname, '..');

function installHint() {
  const relative = path.relative(process.cwd(), TOOLKIT_DIR);
  const target = relative === '' ? '.' : relative.startsWith('..') ? TOOLKIT_DIR : relative;
  return `run: npm ci --prefix ${target}`;
}

// Exit 3 when any declared dependency is missing, so a checkout that never installed the toolkit
// is reported as "not installed" rather than as a failing architecture.
function assertDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(TOOLKIT_DIR, 'package.json'), 'utf8'));
  const missing = Object.keys(manifest.dependencies || {}).filter(
    (name) => !fs.existsSync(path.join(TOOLKIT_DIR, 'node_modules', name, 'package.json')),
  );
  if (!fs.existsSync(path.join(TOOLKIT_DIR, 'node_modules', '.bin', 'calm')) && !missing.includes('@finos/calm-cli')) {
    missing.push('@finos/calm-cli');
  }
  if (missing.length > 0) {
    throw new ToolkitError(
      `toolkit dependencies not installed (${missing.join(', ')}) — ${installHint()}`,
      EXIT.DEPENDENCIES,
    );
  }
}

// node_modules/.bin/calm is a symlink to the CLI's JS entry; running that entry with this process's
// node avoids depending on whichever `node` is first on PATH.
function calmEntry() {
  const shim = path.join(TOOLKIT_DIR, 'node_modules', '.bin', 'calm');
  if (!fs.existsSync(shim)) {
    throw new ToolkitError(`@finos/calm-cli is not installed — ${installHint()}`, EXIT.DEPENDENCIES);
  }
  return fs.realpathSync(shim);
}

function stripAnsi(text) {
  return text.replace(/\[[0-9;]*m/g, '');
}

// Runs the CALM CLI. The exit status is read from the child directly. For `validate`, stdout is the
// JSON report; if it does not parse, `issues` is null and the caller must treat the run as failed.
function runCalm(args) {
  const argv = args[0] === 'validate' ? [...args, '-f', 'json'] : [...args];
  const result = spawnSync(process.execPath, [calmEntry(), ...argv], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  if (result.error) {
    return { exitCode: null, issues: null, stdout: '', stderr: result.error.message };
  }
  let issues = null;
  if (argv[0] === 'validate') {
    try {
      issues = JSON.parse(result.stdout);
    } catch {
      issues = null;
    }
  }
  return { exitCode: result.status, issues, stdout: result.stdout, stderr: stripAnsi(result.stderr || '') };
}

module.exports = { TOOLKIT_DIR, assertDependencies, runCalm };
