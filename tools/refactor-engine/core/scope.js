'use strict';

// Which paths the host config governs. Globs are relative to --root and matched against POSIX paths with
// `{dot: true}`, so a dot-directory is not silently exempt. A pattern rule's own include/exclude narrows the
// scope; it never widens it.

const { requireFromToolkit } = require('./deps');

const cache = new WeakMap();

function matcher(globs) {
    const picomatch = requireFromToolkit('picomatch');
    if (globs.length === 0) return () => false;
    return picomatch(globs, { dot: true });
}

function compiled(owner, includeKey, excludeKey) {
    let entry = cache.get(owner);
    if (!entry) {
        entry = {
            include: owner[includeKey] === null ? () => true : matcher(owner[includeKey]),
            exclude: matcher(owner[excludeKey]),
        };
        cache.set(owner, entry);
    }
    return entry;
}

function inScope(relPath, config) {
    const { include, exclude } = compiled(config.scope, 'include', 'exclude');
    return include(relPath) && !exclude(relPath);
}

// A rule with no `include` applies to every in-scope path; `exclude` is always honoured.
function patternApplies(relPath, rule) {
    const { include, exclude } = compiled(rule, 'include', 'exclude');
    return include(relPath) && !exclude(relPath);
}

module.exports = { inScope, patternApplies };
