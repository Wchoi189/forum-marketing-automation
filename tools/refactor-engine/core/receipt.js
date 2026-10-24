'use strict';

// The receipt `apply` writes and `verify` reads (contracts/recipe-and-config.md "Receipt"): keys in contract order,
// two-space indent, trailing newline; `appliedAt` carries the numeric offset of TZ / the system zone — never `Z`
// unless the zone is UTC. `sourceText` is embedded only when the root is not a git repository, so V-3 can read the
// pre-split source where `git show` cannot.

const fs = require('node:fs');
const path = require('node:path');
const { usageError } = require('./errors');
const { isGitRepo } = require('./repo');

const SCHEMA = 'refactor-engine/receipt/1';

function isoWithOffset(now = new Date()) {
    const pad = (n) => String(Math.abs(n)).padStart(2, '0');
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? '-' : '+';
    const offset = `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offset}`;
}

const receiptPathFor = (config, recipe) => path.posix.join(config.receipts.replace(/\\/g, '/'), `${recipe.name}.receipt.json`);

function buildReceipt({ root, recipe, plan, toolkitVersion, now }) {
    const receipt = {
        $schema: SCHEMA,
        recipe: recipe.name,
        toolkitVersion,
        source: { path: plan.source.path, hash: plan.source.hash, lines: plan.source.lines, bytes: plan.source.bytes },
        appliedAt: isoWithOffset(now),
        moves: plan.moves.map((m) => ({ name: m.name, kind: m.kind, static: m.static, from: m.from, to: m.to, sha256: m.sha256 })),
        generated: plan.generated.map((g) => ({ file: g.file, block: g.block, sha256: g.sha256 })),
    };
    if (!isGitRepo(root)) receipt.sourceText = plan.sourceText;
    return receipt;
}

const serializeReceipt = (receipt) => `${JSON.stringify(receipt, null, 2)}\n`;

function readReceipt(root, relPath) {
    const full = path.resolve(root, relPath);
    if (!fs.existsSync(full)) return null;
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
        throw usageError(`receipt ${relPath} is not valid JSON: ${error.message}`);
    }
    if (raw.$schema !== SCHEMA) throw usageError(`receipt ${relPath}: $schema must be "${SCHEMA}"`);
    for (const key of ['recipe', 'source', 'appliedAt', 'moves', 'generated']) {
        if (!(key in raw)) throw usageError(`receipt ${relPath}: missing ${key}`);
    }
    return raw;
}

// Every move's span is found, by name and kind, in its `to` file with the recorded hash.
function movesApplied(root, receipt) {
    const { inventoryText, spanText, sha256 } = require('./inventory');
    const cache = new Map();
    for (const move of receipt.moves) {
        if (!cache.has(move.to)) {
            const full = path.resolve(root, move.to);
            if (!fs.existsSync(full)) return false;
            cache.set(move.to, inventoryText(move.to, fs.readFileSync(full, 'utf8')));
        }
        const found = findMoved(cache.get(move.to), move);
        if (!found || sha256(spanText(cache.get(move.to).text, found.span)) !== move.sha256) return false;
    }
    return true;
}

// The member or declaration a receipt move names, in an inventoried file.
function findMoved(inventoried, move) {
    const { inventory } = inventoried;
    if (['method', 'get', 'set', 'field', 'constructor'].includes(move.kind)) {
        for (const cls of inventory.classes) {
            const member = cls.members.find((m) => m.name === move.name && m.kind === move.kind && m.static === Boolean(move.static));
            if (member) return member;
        }
        return null;
    }
    return inventory.declarations.find((d) => d.names.join(', ') === move.name && d.kind === move.kind) || null;
}

module.exports = { SCHEMA, isoWithOffset, receiptPathFor, buildReceipt, serializeReceipt, readReceipt, movesApplied, findMoved };
