'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOLKIT = path.resolve(__dirname, '..');
const BIN = path.join(TOOLKIT, 'bin', 'arch-governance.js');
const FIXTURES = path.join(__dirname, 'fixtures');

// Exit status is read from the child directly, never through a pipe.
function run(args, { bin = BIN, cwd = FIXTURES } = {}) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
}

test('valid architecture with a conforming pattern exits 0', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^calm schema\s+valid\.calm\.json\s+ok$/m);
  assert.match(r.stderr, /^calm pattern\s+web-behind-api\.pattern\.json\s+ok$/m);
  assert.match(r.stderr, /^conformance\s+1 pattern\s+ok$/m);
});

test('--json prints one result object on stdout', () => {
  const r = run(['validate', '--strict', '--json', '-c', 'valid.config.json']);
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.command, 'validate');
  assert.equal(result.exitCode, 0);
  assert.ok(result.stages.every((s) => s.ok));
});

test('unknown flag exits 4', () => {
  const r = run(['validate', '--bogus', '-c', 'valid.config.json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /unknown option --bogus/);
});

test('unknown command exits 4', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /unknown command frobnicate/);
});

test('docify --base-url without slashes exits 4', () => {
  const r = run(['docify', '--base-url', 'docs']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /--base-url "docs" must start and end with "\/"/);
});

test('missing config file exits 4', () => {
  const r = run(['validate', '-c', 'no-such.config.json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /cannot read "no-such\.config\.json"/);
});

test('unknown config key exits 4 and names the key', () => {
  const r = run(['validate', '-c', 'unknown-key.config.json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /unknown key "patternBindings"/);
});

test('ignoreHosts entry without a reason exits 4 and names the entry', () => {
  const r = run(['validate', '-c', 'ignore-without-reason.config.json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /rules\.egressCoverage\.ignoreHosts\[1\] \("cdn\.example\.org"\) has no reason/);
});

test('toolkit without node_modules exits 3 and names the install command', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-governance-'));
  try {
    fs.cpSync(path.join(TOOLKIT, 'bin'), path.join(copy, 'bin'), { recursive: true });
    fs.cpSync(path.join(TOOLKIT, 'core'), path.join(copy, 'core'), { recursive: true });
    fs.cpSync(path.join(TOOLKIT, 'checks'), path.join(copy, 'checks'), { recursive: true });
    fs.copyFileSync(path.join(TOOLKIT, 'package.json'), path.join(copy, 'package.json'));
    const r = run(['validate', '-c', 'valid.config.json'], { bin: path.join(copy, 'bin', 'arch-governance.js') });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /run: npm ci --prefix /);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('connects to a node that does not exist exits 1', () => {
  const r = run(['validate', '--strict', '-c', 'schema-invalid.config.json']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^calm schema\s+schema-invalid\.calm\.json\s+FAIL$/m);
  assert.match(r.stderr, /connects-relationship-references-existing-nodes-in-architecture/);
});
