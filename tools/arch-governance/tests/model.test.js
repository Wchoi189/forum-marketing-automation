'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { loadModel } = require('../core/calmModel');

const BIN = path.resolve(__dirname, '..', 'bin', 'arch-governance.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: FIXTURES, encoding: 'utf8' });
}

test('loadModel keeps connects relationships only', () => {
  const model = loadModel(path.join(FIXTURES, 'valid.calm.json'));
  assert.equal(model.nodes.size, 5);
  assert.deepEqual(model.nodes.get('payments'), { type: 'system', zone: 'external', hosts: ['api.payments.example.com'] });
  assert.equal(model.nodes.get('customer').zone, null);
  assert.deepEqual(
    model.edges.map((e) => [e.id, e.source, e.destination, e.protocol]),
    [
      ['rel-web-api', 'web', 'api', 'HTTP'],
      ['rel-api-store', 'api', 'store', null],
      ['rel-api-payments', 'api', 'payments', 'HTTPS'],
    ],
  );
  assert.deepEqual(model.violations, []);
});

test('non-actor node without metadata.zone is a MODEL-METADATA violation', () => {
  const { violations } = loadModel(path.join(FIXTURES, 'missing-zone.calm.json'));
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'MODEL-METADATA');
  assert.match(violations[0].subject, /node store has no metadata\.zone/);
});

test('external node with a non-lower-case host is a MODEL-METADATA violation', () => {
  const { violations } = loadModel(path.join(FIXTURES, 'uppercase-host.calm.json'));
  assert.equal(violations.length, 1);
  assert.match(violations[0].subject, /external node payments host "API\.Payments\.example\.com"/);
});

test('validate exits 2 on a MODEL-METADATA violation', () => {
  for (const fixture of ['missing-zone.calm.json', 'uppercase-host.calm.json']) {
    const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', fixture]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^calm schema\s+\S+\s+ok$/m);
    assert.match(r.stderr, /^MODEL-METADATA\s+zone and hosts \(5 nodes\)\s+FAIL$/m);
  }
});

test('validate exits 1 when the architecture does not conform to a pattern, naming the pattern', () => {
  const r = run(['validate', '--strict', '-c', 'valid.config.json', '-a', 'nonconforming.calm.json']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^calm schema\s+nonconforming\.calm\.json\s+ok$/m);
  assert.match(r.stderr, /^conformance nonconforming\.calm\.json does not conform to web-behind-api\.pattern\.json/m);
});
