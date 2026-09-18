'use strict';

// Spike defect two (research R10): `plan` lists every tracked file that names the source by path, basename or
// basename:line, classified test / document / code, and a code consumer that requires the source needs no action.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { copyFixture, engine, expectExit } = require('./support');

test('plan lists path-keyed test data, line citations in documents, and a code consumer with no action', () => {
    const root = copyFixture('path-refs', { git: true });
    const plan = engine(root, 'plan', 'recipe.json', '--json');
    expectExit(plan, 0);
    const refs = plan.json.pathReferences.map(({ file, line, kind, form, action }) => ({ file, line, kind, form, action }));
    const find = (file, form) => refs.filter((r) => r.file === file && r.form === form);
    assert.deepEqual(find('tests/gate.test.js', 'path'), [{ file: 'tests/gate.test.js', line: 4, kind: 'test', form: 'path', action: 'reconcile' }]);
    assert.deepEqual(find('docs/guide.md', 'line'), [
        { file: 'docs/guide.md', line: 3, kind: 'document', form: 'line', action: 'reconcile' },
        { file: 'docs/guide.md', line: 3, kind: 'document', form: 'line', action: 'reconcile' },
    ]);
    assert.deepEqual(find('src/consumer.js', 'path'), [{ file: 'src/consumer.js', line: 3, kind: 'code', form: 'path', action: 'none' }]);
    assert.equal(refs.filter((r) => r.file === 'src/orders.js').length, 0, 'the source never references itself');
    assert.equal(refs.filter((r) => r.file === 'recipe.json').length, 1, 'the recipe names the source by path');
    // the human plan prints the same three under "path references"
    const human = engine(root, 'plan', 'recipe.json');
    expectExit(human, 0, ['path references', 'tests/gate.test.js:4', 'docs/guide.md:3', 'src/consumer.js:3']);
    fs.rmSync(root, { recursive: true, force: true });
});
