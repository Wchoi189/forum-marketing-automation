'use strict';

// split-module on the CommonJS, ESM and TypeScript fixtures (tasks T057): plan rows, byte-equal output against
// expected/, the export key set and order before and after, the fixture's own check before and after, verify,
// and idempotent re-plan. Every case runs on its own copy; exit codes are read from the child's own status.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES, copyFixture, engine, node, walk, moduleKeys, expectExit } = require('./support');

const CASES = {
    'module-cjs': { check: ['tests/spy.check.js'], ok: 'spy.check: ok', runtime: true },
    'module-esm': { check: ['tests/render.check.js'], ok: 'render.check: ok', runtime: true, esm: true },
    'module-ts': { check: ['tests/types.check.js'], ok: 'types.check: ok', runtime: false, typescript: true },
};

function expectedFiles(name) {
    const dir = path.join(FIXTURES, name, 'expected');
    return [...walk(dir)].map((file) => path.relative(dir, file)).sort();
}

for (const [fixture, opts] of Object.entries(CASES)) {
    test(`${fixture}: plan → apply → verify, byte-equal to expected/`, () => {
        const root = copyFixture(fixture, { typescript: Boolean(opts.typescript) });
        const recipe = JSON.parse(fs.readFileSync(path.join(root, 'recipe.json'), 'utf8'));
        const ext = path.extname(recipe.source);
        const before = opts.runtime ? moduleKeys(root, recipe.source, { esm: Boolean(opts.esm) }) : null;
        expectExit(node(root, ...opts.check), 0, opts.ok);

        // plan: one row per destination, declarations as the recipe lists them, nothing hoisted, no refusal
        const plan = engine(root, 'plan', 'recipe.json', '--json');
        expectExit(plan, 0);
        assert.ok(plan.json, `plan --json printed no object:\n${plan.stdout}`);
        assert.deepEqual(plan.json.refusals, []);
        assert.equal(plan.json.strategy, 'split-module');
        assert.equal(plan.json.host, null);
        const partRows = plan.json.rows.filter((row) => !row.destination.startsWith('(facade)'));
        assert.deepEqual(partRows.map((row) => path.basename(row.destination, ext)), recipe.parts.map((part) => part.name));
        for (const part of recipe.parts) {
            const row = partRows.find((r) => path.basename(r.destination, ext) === part.name);
            assert.deepEqual(row.declarations, part.declarations, `${part.name} declarations`);
            assert.deepEqual(row.members, []);
            assert.equal(row.hostBinding, false);
            assert.equal(row.overLimit, false);
        }
        const facadeRow = plan.json.rows.find((row) => row.destination.startsWith('(facade)'));
        assert.ok(facadeRow, 'facade row');
        assert.deepEqual(facadeRow.hoisted, []);
        assert.equal(plan.json.summary.originalLines, plan.json.rows.reduce((n, row) => n + row.lines, 0) - plan.json.summary.addedLines);

        // apply: every file under expected/ is byte-equal to what apply wrote
        expectExit(engine(root, 'apply', 'recipe.json'), 0);
        const expected = expectedFiles(fixture);
        assert.equal(expected.length, recipe.parts.length + 1, 'expected/ holds the facade and every part');
        for (const rel of expected) {
            const want = fs.readFileSync(path.join(FIXTURES, fixture, 'expected', rel), 'utf8');
            const got = fs.readFileSync(path.join(root, rel), 'utf8');
            assert.equal(got, want, `${rel} differs from expected/`);
        }
        assert.ok(fs.existsSync(path.join(root, 'receipts', `${recipe.name}.receipt.json`)), 'receipt written');

        // the export surface and the behaviour are unchanged
        if (opts.runtime) assert.deepEqual(moduleKeys(root, recipe.source, { esm: Boolean(opts.esm) }), before, 'export keys and order unchanged');
        expectExit(node(root, ...opts.check), 0, opts.ok);
        expectExit(engine(root, 'verify', 'recipe.json'), 0);

        // V-3: an export dropped from the facade's export statement is a finding
        const facadeFile = path.join(root, recipe.source);
        const facadeText = fs.readFileSync(facadeFile, 'utf8');
        const dropped = fixture === 'module-cjs' ? '    applyBanding,\n' : fixture === 'module-esm' ? 'export { colIndexToLetter as letter };\n' : 'export function createReport';
        assert.ok(facadeText.includes(dropped), 'the export to drop is in the facade');
        fs.writeFileSync(facadeFile, facadeText.replace(dropped, fixture === 'module-ts' ? 'function createReport' : ''));
        expectExit(engine(root, 'verify', 'recipe.json'), 2, 'V-3');
        fs.writeFileSync(facadeFile, facadeText);
        expectExit(engine(root, 'verify', 'recipe.json'), 0);

        // idempotent re-plan
        expectExit(engine(root, 'plan', 'recipe.json'), 0, 'nothing to move');
        fs.rmSync(root, { recursive: true, force: true });
    });
}

test('module-cjs: an edit inside the generated block is V-4 drift', () => {
    const root = copyFixture('module-cjs');
    expectExit(engine(root, 'apply', 'recipe.json'), 0);
    const facadeFile = path.join(root, 'src', 'reports.js');
    const facadeText = fs.readFileSync(facadeFile, 'utf8');
    assert.ok(facadeText.includes("require('./parts/palette')"), 'generated block present');
    fs.writeFileSync(facadeFile, facadeText.replace("require('./parts/palette')", "require('./parts/palette.js')"));
    expectExit(engine(root, 'verify', 'recipe.json', '--drift-only'), 2, 'V-4');
    fs.rmSync(root, { recursive: true, force: true });
});

test('module-cjs: a part exports only the names another destination uses', () => {
    const root = copyFixture('module-cjs');
    expectExit(engine(root, 'apply', 'recipe.json'), 0);
    const formatting = fs.readFileSync(path.join(root, 'src', 'parts', 'formatting.js'), 'utf8');
    assert.match(formatting, /module\.exports = \{ formatAll, applyBanding \};/, 'formatRow is internal to the part');
    const palette = fs.readFileSync(path.join(root, 'src', 'parts', 'palette.js'), 'utf8');
    assert.match(palette, /module\.exports = \{ BG, FG, colIndexToLetter \};/);
    fs.rmSync(root, { recursive: true, force: true });
});
