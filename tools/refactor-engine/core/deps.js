'use strict';

// Dependencies are resolved from THIS toolkit's node_modules and nowhere else. `require.resolve` with
// `paths` walks up to ancestor node_modules, so a host repository that happens to install the same package
// at its root would otherwise satisfy the lookup with a different version — and the "not installed" exit 3
// would never fire inside a checkout. The resolved path is therefore checked, not trusted.

const path = require('node:path');
const { missingDependency } = require('./errors');

const TOOLKIT_DIR = path.resolve(__dirname, '..');
const OWN_MODULES = path.join(TOOLKIT_DIR, 'node_modules') + path.sep;
const cache = new Map();

function requireFromToolkit(name) {
    if (cache.has(name)) return cache.get(name);
    let resolved = null;
    try {
        resolved = require.resolve(name, { paths: [TOOLKIT_DIR] });
    } catch {
        resolved = null;
    }
    if (!resolved || !resolved.startsWith(OWN_MODULES)) {
        throw missingDependency(`${name} is not installed for this toolkit; run: npm ci --prefix ${TOOLKIT_DIR}`);
    }
    const mod = require(resolved);
    cache.set(name, mod);
    return mod;
}

module.exports = { TOOLKIT_DIR, requireFromToolkit };
