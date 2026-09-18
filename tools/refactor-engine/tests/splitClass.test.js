'use strict';

// split-class on the CommonJS and ESM fixtures (tasks T039): plan rows, byte-equal output against expected/,
// the host's runtime shape before and after, verify's V-1 and V-4 on hand edits, and idempotent re-plan.
// Every case runs on its own copy; exit codes are read from the child's own status.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TOOLKIT, FIXTURES, copyFixture, engine, node, walk, classShape, expectExit } = require('./support');

const CHECK = ['tests/ledger.check.js'];

function expectedFiles(name) {
    const dir = path.join(FIXTURES, name, 'expected');
    return [...walk(dir)].map((file) => path.relative(dir, file)).sort();
}

for (const fixture of ['class-cjs', 'class-esm']) {
    test(`${fixture}: plan → apply → verify, byte-equal to expected/`, () => {
        const root = copyFixture(fixture);
        const recipe = JSON.parse(fs.readFileSync(path.join(root, 'recipe.json'), 'utf8'));
        const before = classShape(root, recipe.source);
        expectExit(node(root, ...CHECK), 0, 'ledger.check: ok');

        // plan: one row per destination, members and hostBinding as the recipe implies
        const plan = engine(root, 'plan', 'recipe.json', '--json');
        expectExit(plan, 0);
        assert.ok(plan.json, `plan --json printed no object:\n${plan.stdout}`);
        assert.deepEqual(plan.json.refusals, []);
        const rows = Object.fromEntries(plan.json.rows.map((row) => [row.destination, row]));
        const partRows = plan.json.rows.filter((row) => !row.destination.startsWith('(facade)') && !row.destination.endsWith('_shared.js'));
        assert.deepEqual(partRows.map((row) => path.basename(row.destination, '.js')), recipe.parts.map((part) => part.name));
        for (const part of recipe.parts) {
            const row = partRows.find((r) => path.basename(r.destination, '.js') === part.name);
            assert.deepEqual(row.members, part.members, `${part.name} members`);
            assert.equal(row.hostBinding, part.name === 'Posting' || part.members.includes('fromRows'), `${part.name} hostBinding (addEntry reads Ledger.toMinor; fromRows constructs the host)`);
            assert.equal(typeof row.lines, 'number');
            assert.equal(row.overLimit, false);
        }
        assert.ok(rows['(facade) ledger.js'], 'facade row');
        assert.equal(plan.json.summary.originalLines, plan.json.rows.reduce((n, row) => n + row.lines, 0) - plan.json.summary.addedLines);

        // apply: every file under expected/ is byte-equal to what apply wrote
        const apply = engine(root, 'apply', 'recipe.json');
        expectExit(apply, 0);
        const expected = expectedFiles(fixture);
        assert.ok(expected.length >= 3, 'expected/ holds the facade and the parts');
        for (const rel of expected) {
            const want = fs.readFileSync(path.join(FIXTURES, fixture, 'expected', rel), 'utf8');
            const got = fs.readFileSync(path.join(root, rel), 'utf8');
            assert.equal(got, want, `${rel} differs from expected/`);
        }
        assert.ok(fs.existsSync(path.join(root, 'receipts', `${recipe.name}.receipt.json`)), 'receipt written');

        // behaviour and runtime shape unchanged
        expectExit(node(root, ...CHECK), 0, 'ledger.check: ok');
        const after = classShape(root, recipe.source);
        assert.deepEqual(after.keys, before.keys, 'Object.keys(Host.prototype) unchanged');
        assert.deepEqual(after.proto, before.proto, 'own prototype names and descriptor kinds unchanged');
        assert.deepEqual(after.statics, before.statics, 'own constructor names unchanged');
        assert.equal(after.proto.find(([name]) => name === 'label')[1], 'accessor', 'getter still a getter');

        expectExit(engine(root, 'verify', 'recipe.json'), 0);

        // V-1: one character inside a moved method
        const partFile = path.join(root, 'src', 'parts', 'Reporting.js');
        const partText = fs.readFileSync(partFile, 'utf8');
        assert.ok(partText.includes("'ledger:'"), 'moved getter text present in the part');
        fs.writeFileSync(partFile, partText.replace("'ledger:'", "'Ledger:'"));
        expectExit(engine(root, 'verify', 'recipe.json'), 2, ['V-1', 'label']);
        fs.writeFileSync(partFile, partText);
        expectExit(engine(root, 'verify', 'recipe.json'), 0);

        // V-4: an edit inside the generated block
        const facadeFile = path.join(root, recipe.source);
        const facadeText = fs.readFileSync(facadeFile, 'utf8');
        assert.ok(facadeText.includes("key !== 'constructor'"), 'generated block present');
        fs.writeFileSync(facadeFile, facadeText.replace("key !== 'constructor'", "key !== 'constructor' && key !== 'x'"));
        expectExit(engine(root, 'verify', 'recipe.json'), 2, 'V-4');
        expectExit(engine(root, 'verify', 'recipe.json', '--drift-only'), 2, 'V-4');
        fs.writeFileSync(facadeFile, facadeText);

        // idempotent re-plan
        const again = engine(root, 'plan', 'recipe.json');
        expectExit(again, 0, 'nothing to move');
        fs.rmSync(root, { recursive: true, force: true });
    });
}

test('verify --json reports capabilityBytes per moved member (SC-4)', () => {
    const root = copyFixture('class-cjs');
    expectExit(engine(root, 'apply', 'recipe.json'), 0);
    const result = engine(root, 'verify', 'recipe.json', '--json');
    expectExit(result, 0);
    const bytes = result.json.capabilityBytes;
    assert.equal(bytes.length, 8);
    const entry = bytes.find((b) => b.member === 'total');
    assert.equal(entry.part, 'src/parts/Reporting.js');
    assert.ok(entry.bytes > 0 && entry.ratio > 0 && entry.ratio < 2, JSON.stringify(entry));
    fs.rmSync(root, { recursive: true, force: true });
});

test('V-6: a file that imports a part directly is a finding', () => {
    const root = copyFixture('class-cjs');
    expectExit(engine(root, 'apply', 'recipe.json'), 0);
    fs.writeFileSync(path.join(root, 'src', 'direct.js'), "'use strict';\nconst Reporting = require('./parts/Reporting');\nmodule.exports = Reporting;\n");
    expectExit(engine(root, 'verify', 'recipe.json'), 2, ['V-6', 'src/direct.js:2']);
    fs.rmSync(root, { recursive: true, force: true });
});

test('advisory affinity is never read by the planner or apply', () => {
    for (const file of ['planner.js', 'apply.js']) {
        const text = fs.readFileSync(path.join(TOOLKIT, 'core', file), 'utf8');
        assert.ok(!/affinity/.test(text), `core/${file} mentions affinity`);
    }
});
