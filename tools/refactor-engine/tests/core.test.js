'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveExit, ToolkitError } = require('../core/errors');
const { requireFromToolkit } = require('../core/deps');
const { parse, languageOf, physicalLines, lineOf } = require('../core/parser');

test('resolveExit applies 4 > 3 > 2 > 1 > 0', () => {
    assert.equal(resolveExit([]), 0);
    assert.equal(resolveExit([0, 0]), 0);
    assert.equal(resolveExit([1, 2]), 2);
    assert.equal(resolveExit([2, 3, 1]), 3);
    assert.equal(resolveExit([1, 4, 3]), 4);
    assert.equal(resolveExit([7]), 4, 'an out-of-range code is a defect, never success');
});

test('requireFromToolkit refuses a package the toolkit does not own with exit 3', () => {
    assert.throws(
        () => requireFromToolkit('definitely-not-installed-package-xyz'),
        (error) => error instanceof ToolkitError && error.exitCode === 3 && /npm ci --prefix/.test(error.message),
    );
    assert.equal(typeof requireFromToolkit('typescript').createSourceFile, 'function');
});

test('physicalLines matches wc -l for newline-terminated text', () => {
    assert.equal(physicalLines(''), 0);
    assert.equal(physicalLines('a\n'), 1);
    assert.equal(physicalLines('a\nb\n'), 2);
    assert.equal(physicalLines('a\nb'), 2, 'an unterminated final line still counts');
    assert.equal(physicalLines('\n\n'), 2);
});

test('languageOf distinguishes cjs, esm, ts and tsx', () => {
    const lang = (name, text) => languageOf(name, parse(name, text));
    assert.equal(lang('a.js', "const x = require('x');\nmodule.exports = x;\n"), 'cjs');
    assert.equal(lang('a.js', "import x from 'x';\n"), 'esm');
    assert.equal(lang('a.js', 'export function f() {}\n'), 'esm');
    assert.equal(lang('a.mjs', 'const a = 1;\n'), 'esm');
    assert.equal(lang('a.cjs', "export {};\n"), 'cjs');
    assert.equal(lang('a.ts', 'export type A = string;\n'), 'ts');
    assert.equal(lang('a.tsx', 'export const A = () => <div />;\n'), 'tsx');
});

test('lineOf is 1-based', () => {
    const sf = parse('a.js', 'one\ntwo\nthree\n');
    assert.equal(lineOf(sf, 0), 1);
    assert.equal(lineOf(sf, 4), 2);
});
