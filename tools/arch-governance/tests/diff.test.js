'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { render } = require('../core/diffMarkdown');

const BIN = path.resolve(__dirname, '..', 'bin', 'arch-governance.js');
const FIXTURES = path.join(__dirname, 'fixtures');
// Captured from `calm diff -a diff-base.calm.json -b diff-candidate.calm.json -f json` (CALM 1.59.0).
const CAPTURED = require('./fixtures/calm-diff-output.json');

// Exit status is read from the child directly, never through a pipe.
function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: FIXTURES, encoding: 'utf8' });
}

test('render: captured CALM diff becomes the contract table', () => {
  assert.equal(
    render(CAPTURED, 'diff-base.calm.json', 'diff-candidate.calm.json'),
    [
      '### Architecture diff — diff-base.calm.json → diff-candidate.calm.json',
      '',
      '| | Added | Removed | Modified |',
      '|---|---|---|---|',
      '| Nodes | `redis-cache` (service) | — | — |',
      '| Relationships | `rel-api-cache` | — | `rel-api-db` |',
    ].join('\n'),
  );
});

test('render: removed, modified and renamed items', () => {
  const diff = {
    nodesRemoved: [{ 'unique-id': 'old-node', 'node-type': 'system' }],
    nodesModified: [{ original: { 'unique-id': 'n1' }, updated: { 'unique-id': 'n1' } }],
    nodesRenamed: [{ oldId: 'n2', newId: 'n2-new', node: { 'unique-id': 'n2-new' } }],
    edgesRemoved: [{ 'unique-id': 'rel-a' }, { 'unique-id': 'rel-b' }],
  };
  const lines = render(diff, 'a.json', 'b.json').split('\n');
  assert.equal(lines[4], '| Nodes | — | `old-node` | `n1`, `n2` → `n2-new` |');
  assert.equal(lines[5], '| Relationships | — | `rel-a`, `rel-b` | — |');
});

test('diff --format markdown names the added node and relationship', () => {
  const r = run(['diff', '-a', 'diff-base.calm.json', '-b', 'diff-candidate.calm.json', '--format', 'markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^### Architecture diff — diff-base\.calm\.json → diff-candidate\.calm\.json$/m);
  assert.match(r.stdout, /`redis-cache` \(service\)/);
  assert.match(r.stdout, /`rel-api-cache`/);
});

test('invalid candidate exits 1 and prints no diff', () => {
  const r = run(['diff', '-a', 'diff-base.calm.json', '-b', 'schema-invalid.calm.json', '--format', 'markdown']);
  assert.equal(r.status, 1, r.stderr);
  assert.doesNotMatch(r.stdout, /\|/);
  assert.match(r.stderr, /^calm schema\s+schema-invalid\.calm\.json\s+FAIL$/m);
});

test('-a defaults to the config architecture', () => {
  const r = run(['diff', '-c', 'valid.config.json', '-b', 'valid.calm.json', '-f', 'markdown']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^### Architecture diff — valid\.calm\.json → valid\.calm\.json$/m);
  assert.match(r.stdout, /^\| Nodes \| — \| — \| — \|$/m);
});

test('summary passes through; --exit-code is non-zero when changes exist', () => {
  const summary = run(['diff', '-a', 'diff-base.calm.json', '-b', 'diff-candidate.calm.json']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /CALM architecture diff/);

  const changed = run(['diff', '-a', 'diff-base.calm.json', '-b', 'diff-candidate.calm.json', '--exit-code']);
  assert.equal(changed.status, 1, changed.stderr);
  const same = run(['diff', '-a', 'diff-base.calm.json', '-b', 'diff-base.calm.json', '--exit-code']);
  assert.equal(same.status, 0, same.stderr);
});

test('diff without -b exits 4', () => {
  const r = run(['diff', '-a', 'diff-base.calm.json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /diff requires -b/);
});

test('diff rejects an unknown --format and validate-only options', () => {
  assert.equal(run(['diff', '-a', 'diff-base.calm.json', '-b', 'diff-candidate.calm.json', '-f', 'xml']).status, 4);
  assert.equal(run(['diff', '-b', 'diff-candidate.calm.json', '--strict']).status, 4);
});
