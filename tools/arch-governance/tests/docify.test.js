'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { rewriteBaseUrl, rewriteStylesheet } = require('../core/docify');
const { EXIT, ToolkitError } = require('../core/errors');

const BIN = path.resolve(__dirname, '..', 'bin', 'arch-governance.js');
const FIXTURES = path.join(__dirname, 'fixtures');

const CONFIG = [
  'module.exports = {',
  "    title: 'Docs',",
  "    url: 'http://localhost',",
  "    baseUrl: '/',",
  "    onBrokenLinks: 'throw',",
  '};',
].join('\n');

function assertTemplateChanged(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ToolkitError);
    assert.equal(error.exitCode, EXIT.CALM);
    assert.match(error.message, /^docify template changed: baseUrl literal not found/);
    return true;
  });
}

test('rewriteBaseUrl: exactly one literal is rewritten', () => {
  const out = rewriteBaseUrl(CONFIG, '/docs/architecture/');
  assert.match(out, /^ {4}baseUrl: '\/docs\/architecture\/',$/m);
  assert.doesNotMatch(out, /baseUrl: '\/',/);
  assert.equal(out.replace("'/docs/architecture/'", "'/'"), CONFIG);
});

test('rewriteBaseUrl: zero literals throws', () => {
  assertTemplateChanged(() => rewriteBaseUrl(CONFIG.replace("baseUrl: '/'", "baseUrl: '/x/'"), '/docs/'));
});

test('rewriteBaseUrl: two literals throws', () => {
  assertTemplateChanged(() => rewriteBaseUrl(`${CONFIG}\n// baseUrl: '/'`, '/docs/'));
});

test('rewriteStylesheet: the root-absolute stylesheet moves under the base URL', () => {
  const text = "    stylesheets: [\n        '/css/custom.css'\n    ],";
  assert.equal(rewriteStylesheet(text, '/docs/architecture/'), "    stylesheets: [\n        '/docs/architecture/css/custom.css'\n    ],");
  assert.throws(() => rewriteStylesheet('stylesheets: []', '/docs/'), /^ToolkitError: docify template changed: stylesheet literal not found/);
});

test('docify rejects an option that belongs to another command', () => {
  const r = spawnSync(process.execPath, [BIN, 'docify', '-b', 'x.json'], { cwd: FIXTURES, encoding: 'utf8' });
  assert.equal(r.status, EXIT.USAGE, r.stderr);
  assert.match(r.stderr, /option -b does not apply to docify/);
});
