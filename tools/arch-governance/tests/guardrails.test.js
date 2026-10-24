'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.resolve(__dirname, '..', 'bin', 'arch-governance.js');
const FIXTURES = path.join(__dirname, 'fixtures');

// Exit status is read from the child directly, never through a pipe.
function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: FIXTURES, encoding: 'utf8' });
}

test('every guardrail stage reports ok on the valid fixture', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^ARCH-001\s+forbidden connections\s+ok$/m);
  assert.match(r.stderr, /^ARCH-002\s+egress origins\s+ok$/m);
  assert.match(r.stderr, /^ARCH-003\s+egress coverage \(1 file, 2 hosts\)\s+ok$/m);
});

// T023 — ARCH-001 / ARCH-002

test('ARCH-001: a client-zone node connecting to a database exits 2', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', 'client-to-db.calm.json']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^conformance\s+1 pattern\s+ok$/m);
  assert.match(r.stderr, /^ARCH-001\s+forbidden connections\s+FAIL$/m);
  assert.match(r.stderr, /^ARCH-001 client-to-store rel-web-store: A browser client must reach data only through the API\.  web -> store$/m);
  assert.match(r.stderr, /^ARCH-002\s+egress origins\s+ok$/m);
});

test('ARCH-002: a client-zone node connecting to an external node exits 2', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', 'browser-egress.calm.json']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^ARCH-002\s+egress origins\s+FAIL$/m);
  assert.match(r.stderr, /^ARCH-002 rel-web-payments reaches zone external from zone client  web -> payments$/m);
  assert.match(r.stderr, /^ARCH-001\s+forbidden connections\s+ok$/m);
});

test('ARCH-002: an edge out of the external zone (a webhook) is unconstrained', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', 'webhook.calm.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^ARCH-002\s+egress origins\s+ok$/m);
});

// T024 — ARCH-003

test('ARCH-003: a host in source that no node declares exits 2 and names the first location', () => {
  const r = run(['validate', '--strict', '-c', 'unmapped-host/config.json']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^ARCH-003\s+egress coverage \(1 file, 2 hosts\)\s+FAIL$/m);
  assert.match(r.stderr, /^ARCH-003 unmapped host api\.newvendor\.com  unmapped-host\/src\/newVendor\.js:4 \(\+1 more\)$/m);
  assert.doesNotMatch(r.stderr, /ARCH-003 \S+ host api\.payments\.example\.com/);
});

test('ARCH-003: a declared host no source file names exits 2 and names the node', () => {
  const r = run(['validate', '--strict', '-c', 'stale-host/config.json']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^ARCH-003 declared host unused api\.retired\.example\.com  node payments$/m);
  assert.doesNotMatch(r.stderr, /unmapped host/);
});

test('ARCH-003: source hosts match declared hosts case-insensitively', () => {
  // fixtures/src/payments.js names https://API.Payments.Example.com; the model declares it lower-case.
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const stage = JSON.parse(r.stdout).stages.find((s) => s.stage === 'ARCH-003');
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.findings, []);
});

test('ARCH-003: an ignoreHosts entry suppresses its host', () => {
  // fixtures/src/payments.js also names https://docs.example.org, which only ignoreHosts covers.
  const r = run(['validate', '--strict', '-c', 'valid.config.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /docs\.example\.org/);
});

// T025 — placeholders are CALM's call: an error under --strict, a warning without it (Q3 "soft")

test('a placeholder fails --strict with exit 1', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', 'placeholder.calm.json']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /architecture-has-no-placeholder-properties/);
});

test('a placeholder without --strict exits 0 and prints the warning', () => {
  const r = run(['validate', '-c', 'valid.config.json', '-a', 'placeholder.calm.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /architecture-has-no-placeholder-properties/);
});
