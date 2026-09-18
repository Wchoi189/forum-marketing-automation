'use strict';

// Every directory under fixtures/refusals/ (tasks T038, T056): `plan` exits as expect.json says and names the code and the
// member or declaration; on a refusal `apply` writes NOTHING (directory tree hash unchanged); on a pass case
// `apply` writes. `source-changed` is the one case that needs a step between plan and apply.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES, copyFixture, engine, treeHash, expectExit } = require('./support');

const ROOT = path.join(FIXTURES, 'refusals');
const CASES = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const config = ['-c', path.join(ROOT, 'config.json')];

test('refusal fixtures exist for every catalog code that applies to classes', () => {
    const codes = new Set(CASES.map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, name, 'expect.json'), 'utf8')).code).filter(Boolean));
    for (const code of ['RF-PRIVATE-NAME', 'RF-CLASS-FIELD', 'RF-LOCATION-SENSITIVE', 'RF-DYNAMIC-REQUIRE', 'RF-COMPUTED-THIS', 'RF-MUTABLE-STATE', 'RF-SIDE-EFFECT', 'RF-NAME-COLLISION', 'RF-TS-CLASS', 'RF-SOURCE-CHANGED', 'RF-PART-CYCLE']) {
        assert.ok(codes.has(code), `no fixture for ${code}`);
    }
});

for (const name of CASES) {
    test(`refusal fixture ${name}`, () => {
        const expect = JSON.parse(fs.readFileSync(path.join(ROOT, name, 'expect.json'), 'utf8'));
        const root = copyFixture(`refusals/${name}`);
        const includes = [expect.code, expect.member, expect.declaration, expect.message].filter(Boolean);
        try {
            if (name === 'source-changed') {
                const plan = engine(root, 'plan', 'recipe.json', '--json', ...config);
                expectExit(plan, 0);
                fs.writeFileSync(path.join(root, 'plan.json'), plan.stdout);
                fs.appendFileSync(path.join(root, 'src', 'host.js'), '\n');
                const before = treeHash(root);
                expectExit(engine(root, 'apply', 'recipe.json', '--plan', 'plan.json', ...config), expect.exit, includes);
                assert.equal(treeHash(root), before, 'apply wrote something on a refusal');
                return;
            }
            const plan = engine(root, 'plan', 'recipe.json', ...config);
            expectExit(plan, expect.exit, includes);
            const before = treeHash(root);
            const apply = engine(root, 'apply', 'recipe.json', ...config);
            if (expect.exit === 0) {
                expectExit(apply, 0);
                assert.notEqual(treeHash(root), before, 'apply on a pass case wrote nothing');
            } else {
                expectExit(apply, expect.exit, includes);
                assert.equal(treeHash(root), before, 'apply wrote something on a refusal');
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}
