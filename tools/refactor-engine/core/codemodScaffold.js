'use strict';

// `codemod new <dir>`: the directory layout `codemod test` expects, with a working example rewrite and one positive
// and one negative fixture. `why` is written empty on purpose: the codemod does not load until its reason exists,
// the same rule the host config applies to a ratchet pattern.

const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { usageError } = require('./errors');
const { toPosix } = require('./repo');
const { SCHEMA } = require('./codemod');
const { catalogMatcher } = require('./codemodCatalog');

const EXAMPLE_PATTERN = `language js

// Replace this example. A pattern is self-contained: the GritQL standard library is not available.
// Match an identifier inside a string or a declaration with a string pattern ("oldName" => \`newName\`).
\`replaceMe($args)\` => \`replaced($args)\`
`;

function scaffoldCodemod({ root, config, dirArg, ratchet }) {
    const dir = toPosix(path.relative(root, path.resolve(root, dirArg)));
    if (dir === '' || dir.startsWith('..')) throw usageError(`${dirArg} is outside the root ${root}`);
    const id = path.posix.basename(dir);
    if (!cfg.KEBAB.test(id)) throw usageError(`codemod new: the directory name "${id}" is the codemod id and must be kebab-case`);
    const full = path.join(root, dir);
    if (fs.existsSync(full)) throw usageError(`codemod new: ${dir} already exists`);

    let include = config.scope.include;
    let exclude = config.scope.exclude;
    if (ratchet !== undefined) {
        const rule = config.patterns.find((p) => p.id === ratchet);
        if (!rule) throw usageError(`codemod new: --ratchet ${ratchet} is not a pattern in the host config (${config.patterns.map((p) => p.id).join(', ') || 'none'})`);
        if (rule.include !== null) include = rule.include;
        exclude = [...new Set([...config.scope.exclude, ...rule.exclude])];
    }

    const meta = {
        $schema: SCHEMA,
        id,
        engine: 'grit',
        pattern: `${id}.grit`,
        why: '',
        include,
        exclude,
        ...(ratchet !== undefined ? { ratchet } : {}),
        review: [],
    };
    const files = {
        'codemod.json': `${JSON.stringify(meta, null, 2)}\n`,
        [`${id}.grit`]: EXAMPLE_PATTERN,
        'fixtures/rewrites/input.js': 'replaceMe(1);\n',
        'fixtures/rewrites/expected.js': 'replaced(1);\n',
        'fixtures/leaves-alone/input.js': "keepMe(1);\nconst label = 'replaceMe(1)';\n",
    };
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(full, name)), { recursive: true });
        fs.writeFileSync(path.join(full, name), content);
    }
    return { dir, id, files: Object.keys(files).map((name) => path.posix.join(dir, name)), inCatalog: catalogMatcher(config)(dir) };
}

module.exports = { scaffoldCodemod };
