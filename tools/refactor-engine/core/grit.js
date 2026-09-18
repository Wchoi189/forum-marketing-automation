'use strict';

// GritQL engine adapter: one pattern, one file, in memory. The napi binding (`@getgrit/gritql`) ships per-platform
// binaries through optionalDependencies, so the lockfile pins and verifies them exactly as it does `@ast-grep/napi`.
// The npm CLI package (`@getgrit/cli`) is NOT used: its postinstall downloads an unverified binary from GitHub.
//
// Hermetic by construction. Measured 2026-09-17 against 0.0.3: the first query of a process resolves the standard
// library by `git clone https://github.com/getgrit/stdlib` into `$GRIT_GLOBAL_DIR/.gritmodules/` (or a directory
// derived from the binary's location, which is not writable). A pre-created, EMPTY module directory satisfies the
// resolver without a clone — verified with networking removed (`unshare -rn`). So the adapter points
// GRIT_GLOBAL_DIR at a private temporary directory holding that empty placeholder, always, whatever the caller's
// environment says. Recipes therefore cannot call stdlib patterns; each `.grit` file must be self-contained.
//
// Marzano pads snippet newlines only for whitespace-significant languages (crates/core marzano_resolved_pattern.rs,
// `should_pad_snippet`): in JavaScript a line after a newline in a rewrite snippet starts at column 0. The kernel's
// indentation pass (core/codemodText.js) restores it; this adapter returns the engine's bytes untouched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { requireFromToolkit } = require('./deps');
const { usageError } = require('./errors');

const PACKAGE = '@getgrit/gritql';
const STDLIB_PLACEHOLDER = ['.gritmodules', 'github.com', 'getgrit', 'stdlib'];

let globalDir = null;

function hermeticGlobalDir() {
    if (globalDir !== null) return globalDir;
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-engine-grit-'));
    fs.mkdirSync(path.join(globalDir, ...STDLIB_PLACEHOLDER), { recursive: true });
    process.on('exit', () => fs.rmSync(globalDir, { recursive: true, force: true }));
    return globalDir;
}

function loadGrit() {
    const binding = requireFromToolkit(PACKAGE);
    process.env.GRIT_GLOBAL_DIR = hermeticGlobalDir();
    return binding;
}

function engineVersion() {
    const { TOOLKIT_DIR } = require('./deps');
    const manifest = path.join(TOOLKIT_DIR, 'node_modules', ...PACKAGE.split('/'), 'package.json');
    return `${PACKAGE}@${JSON.parse(fs.readFileSync(manifest, 'utf8')).version}`;
}

// A pattern must declare its language on a `language` line: without one Marzano silently defaults to JavaScript,
// and a recipe meant for another grammar would match nothing and report "no change".
function validatePatternSource(source, where) {
    if (!/^\s*language\s+\w+/m.test(source)) throw usageError(`${where} must declare its grammar on a "language" line`);
    return source;
}

const hashOf = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');

// The rewritten text, or null when the pattern changed nothing. `relPath` selects the grammar by extension.
async function applyPattern(binding, source, relPath, text) {
    const query = new binding.QueryBuilder(source);
    let result;
    try {
        result = await query.applyToFile({ path: relPath, content: text });
    } catch (error) {
        throw usageError(`grit pattern failed on ${relPath}: ${String(error.message || error).split('\n')[0]}`);
    }
    if (!result || result.content === text) return null;
    return result.content;
}

module.exports = { loadGrit, engineVersion, validatePatternSource, applyPattern, hashOf };
