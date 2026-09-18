'use strict';

// `verify` (data-model.md §3 invariants): V-1 lossless, V-2 removed, V-3 shape, V-4 drift, V-6 sole entry, then the
// optional runtime load and the host's commands. Findings are collected, not thrown, so one run reports them all;
// commands run only when every invariant holds. For split-module, V-3 is the export surface (keys and, in
// CommonJS, their order), V-4 compares the bindings block by hash, and the runtime load reads `Object.keys`.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { usageError } = require('./errors');
const { inventoryText, spanText, sha256 } = require('./inventory');
const { readReceipt, receiptPathFor, findMoved } = require('./receipt');
const { findBlocks, partsBlockCjs, partsBlockEsm, relativeSpecifier, stripExt } = require('./emit/blocks');
const { findImporters } = require('./pathReferences');
const { git, isGitRepo } = require('./repo');

const SHARED_BASENAME = /^_shared\.[cm]?[jt]sx?$/;
const CLASS_KINDS = new Set(['method', 'get', 'set', 'field', 'constructor']);

function readRel(root, relPath) {
    const full = path.resolve(root, relPath);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function sourceTextOf(root, receipt) {
    if (receipt.source.hash.startsWith('sha256:')) {
        if (typeof receipt.sourceText !== 'string') throw usageError(`receipt has no sourceText and ${receipt.source.hash} is not a git object`);
        return receipt.sourceText;
    }
    if (!isGitRepo(root)) throw usageError(`receipt names git object ${receipt.source.hash} but ${root} is not a git repository`);
    const result = git(root, ['cat-file', '-p', receipt.source.hash], { allowFailure: true });
    if (result.status !== 0) throw usageError(`git cat-file ${receipt.source.hash} exited ${result.status}: ${result.stderr.trim()}`);
    return result.stdout;
}

const memberKey = (m) => `${m.static ? 'static ' : ''}${m.kind} ${m.name}`;

function verifyRecipe({ root, config, recipe, driftOnly = false, json = false }) {
    const receiptPath = receiptPathFor(config, recipe);
    const receipt = readReceipt(root, receiptPath);
    if (!receipt) throw usageError(`no receipt at ${receiptPath}; run apply first`);
    const findings = [];
    const finding = (check, message) => findings.push({ check, message });
    const facadePath = receipt.source.path;
    const facadeText = readRel(root, facadePath);
    if (facadeText === null) throw usageError(`facade ${facadePath} does not exist`);
    const facadeDir = path.posix.dirname(facadePath);
    const partFiles = [...new Set(receipt.moves.map((m) => m.to))];
    const classParts = partFiles.filter((f) => !SHARED_BASENAME.test(path.posix.basename(f)));
    const inventoried = new Map();
    const inventoryOf = (relPath) => {
        if (!inventoried.has(relPath)) {
            const text = readRel(root, relPath);
            inventoried.set(relPath, text === null ? null : inventoryText(relPath, text));
        }
        return inventoried.get(relPath);
    };

    // V-4 drift: for split-class the parts block is regenerated from the receipt; any other generated block (and
    // every block of a split-module facade) is compared by hash.
    const facadeInventory = inventoryText(facadePath, facadeText);
    const { indent, newline, language } = facadeInventory.inventory;
    const splitModule = recipe.strategy === 'split-module';
    const hostName = recipe.host;
    const blocks = findBlocks(facadeText);
    const recorded = receipt.generated.filter((g) => g.file === facadePath);
    let copyBlock = null;
    if (!splitModule) {
        const partBlocks = classParts.map((file) => {
            const display = relativeSpecifier(facadeDir, file);
            return { name: path.posix.basename(file).replace(/\.[^.]+$/, ''), names: receipt.moves.filter((m) => m.to === file && CLASS_KINDS.has(m.kind)).map((m) => m.name), display, specifier: stripExt(display) };
        });
        const hasStatic = receipt.moves.some((m) => m.static && CLASS_KINDS.has(m.kind));
        const expectedParts = (language === 'esm' ? partsBlockEsm : partsBlockCjs)({ host: hostName, parts: partBlocks, hasStatic, indent, newline }).replace(/\r\n/g, '\n');
        copyBlock = blocks.filter((b) => b.name === 'parts').find((b) => b.text.includes('Object.getOwnPropertyNames(Part.prototype)'));
        if (!copyBlock) finding('V-4', `${facadePath}: the generated parts block is missing`);
        else if (copyBlock.text !== expectedParts) finding('V-4', `${facadePath}: the generated parts block differs from what the toolkit emits for ${receiptPath} (edit inside the BEGIN/END markers)`);
    }
    for (const entry of recorded) {
        if (entry.block === 'parts' && !splitModule) continue;
        const block = blocks.find((b) => b.name === entry.block || (entry.block === 'imports' && b.name === 'parts' && b !== copyBlock));
        if (!block) finding('V-4', `${facadePath}: the generated ${entry.block} block is missing`);
        else if (sha256(block.text) !== entry.sha256) finding('V-4', `${facadePath}: the generated ${entry.block} block was edited`);
    }
    if (driftOnly) return { findings, commands: [], capabilityBytes: [] };

    // V-1 lossless, V-2 removed
    const movedTexts = [];
    for (const move of receipt.moves) {
        const target = inventoryOf(move.to);
        if (!target) {
            finding('V-1', `${move.name}: ${move.to} does not exist`);
            continue;
        }
        const found = findMoved(target, move);
        if (!found) {
            finding('V-1', `${move.name}: not found in ${move.to}`);
            continue;
        }
        const text = spanText(target.text, found.span);
        if (sha256(text) !== move.sha256) {
            finding('V-1', `${move.name}: ${move.to}:${found.span.startLine} differs from the text moved from ${facadePath}:${move.from.startLine} (sha256 ${sha256(text).slice(0, 12)} ≠ ${move.sha256.slice(0, 12)})`);
            continue;
        }
        movedTexts.push({ move, text });
    }
    for (const { move, text } of movedTexts) {
        if (facadeText.includes(text)) finding('V-2', `${move.name}: its moved text still occurs in ${facadePath}`);
    }

    // V-3 shape. split-module: the export surface of the facade equals the source's — CommonJS keys in order,
    // ESM/TS the name set and whether there is a default. split-class: the source's member set equals the union
    // of the facade's and the parts'.
    const sourceInventory = inventoryText(facadePath, sourceTextOf(root, receipt));
    const sourceExports = sourceInventory.inventory.moduleExports;
    if (splitModule) {
        const facadeExports = facadeInventory.inventory.moduleExports;
        const surface = (e) => (language === 'cjs' ? e.names : [...e.names].sort().concat(e.hasDefault ? ['default'] : []));
        if (!sourceExports.names) finding('V-3', `${facadePath}: the recorded source's export surface cannot be read statically (a spread or \`export *\`)`);
        else if (!facadeExports.names) finding('V-3', `${facadePath}: the export surface cannot be read statically (a spread or \`export *\`)`);
        else {
            const expected = surface(sourceExports);
            const actual = surface(facadeExports);
            const missing = expected.filter((k) => !actual.includes(k));
            const extra = actual.filter((k) => !expected.includes(k));
            if (missing.length > 0 || extra.length > 0) finding('V-3', `export surface changed: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
            else if (expected.join(',') !== actual.join(',')) finding('V-3', `export order changed: source [${expected.join(', ')}], facade [${actual.join(', ')}]`);
        }
    }
    const sourceHost = splitModule ? null : sourceInventory.inventory.classes.find((c) => c.name === hostName);
    const facadeHost = splitModule ? null : facadeInventory.inventory.classes.find((c) => c.name === hostName);
    if (!splitModule && !sourceHost) finding('V-3', `${hostName} is not a class in the recorded source`);
    if (!splitModule && !facadeHost) finding('V-3', `${hostName} is not a class in ${facadePath}`);
    if (sourceHost && facadeHost) {
        const expected = sourceHost.members.map(memberKey).sort();
        const actual = [...facadeHost.members.map(memberKey)];
        for (const file of classParts) {
            const part = inventoryOf(file);
            if (!part) continue;
            for (const cls of part.inventory.classes) actual.push(...cls.members.filter((m) => m.kind !== 'constructor').map(memberKey));
        }
        actual.sort();
        const missing = expected.filter((k) => !actual.includes(k));
        const extra = actual.filter((k) => !expected.includes(k));
        if (missing.length > 0 || extra.length > 0) finding('V-3', `${hostName} member set changed: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
    }

    // V-6 sole entry (split-class): no file other than the facade requires or imports a class part
    if (!splitModule) {
        for (const importer of findImporters({ root, targets: classParts, except: [facadePath] })) {
            finding('V-6', `${importer.file}:${importer.line} imports ${importer.target} directly; a part loaded before its facade throws (research R13) — import ${facadePath} instead`);
        }
    }

    // Runtime export surface (split-module), in a child process: `Object.keys` of the facade's export object
    // against the recorded source's. ESM is loaded with import() — require(esm) on Node 22+ adds `__esModule` —
    // and TypeScript cannot be loaded by node and is skipped.
    if (findings.length === 0 && recipe.verify.loadModule && splitModule && (language === 'cjs' || language === 'esm') && sourceExports.names) {
        const result = spawnSync(process.execPath, ['-e', KEYS_SCRIPT, '--', language, path.resolve(root, facadePath)], { cwd: root, encoding: 'utf8' });
        if (result.status !== 0) finding('V-LOAD', `loading ${facadePath} failed: ${(result.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
        else {
            const keys = JSON.parse(result.stdout);
            const expected = language === 'cjs' ? sourceExports.names : [...sourceExports.names].concat(sourceExports.hasDefault ? ['default'] : []).sort();
            if (keys.join(',') !== expected.join(',')) finding('V-LOAD', `${facadePath} exports [${keys.join(', ')}] at runtime; the source exported [${expected.join(', ')}]`);
        }
    }

    // Runtime shape (split-class), in a child process, only when the invariants hold
    if (findings.length === 0 && recipe.verify.loadModule && sourceHost) {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', LOAD_SCRIPT, '--', require('node:url').pathToFileURL(path.resolve(root, facadePath)).href, hostName], { cwd: root, encoding: 'utf8' });
        if (result.status !== 0) finding('V-LOAD', `requiring ${facadePath} failed: ${(result.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
        else {
            const shape = JSON.parse(result.stdout);
            for (const member of sourceHost.members) {
                if (member.kind === 'constructor') continue;
                const owner = member.static ? shape.statics : shape.proto;
                const entry = owner.find(([name]) => name === member.name);
                const expectedKind = member.kind === 'get' || member.kind === 'set' ? 'accessor' : member.kind === 'field' ? null : 'function';
                if (!entry) {
                    if (member.kind !== 'field') finding('V-LOAD', `${hostName}${member.static ? '' : '.prototype'} has no own property ${member.name} at runtime`);
                } else if (expectedKind && entry[1] !== expectedKind) finding('V-LOAD', `${member.name} is a ${entry[1]} at runtime, not a ${expectedKind}`);
                else if (!member.static && entry[2]) finding('V-LOAD', `${member.name} became enumerable on ${hostName}.prototype`);
            }
        }
    }

    // capabilityBytes (SC-4, research R19): facade bytes + part bytes per moved member, against the original
    const facadeBytes = Buffer.byteLength(facadeText);
    const capabilityBytes = receipt.moves.filter((m) => splitModule || CLASS_KINDS.has(m.kind)).map((m) => {
        const partText = readRel(root, m.to) || '';
        const bytes = facadeBytes + Buffer.byteLength(partText);
        return { member: m.name, part: m.to, bytes, ratio: receipt.source.bytes ? Number((bytes / receipt.source.bytes).toFixed(4)) : null };
    });

    const commands = [];
    if (findings.length === 0) {
        for (const command of config.verify.commands) {
            // Under --json the child's stdout goes to stderr, so stdout stays one result object (contracts/cli.md).
            // fd 1 is wired straight to fd 2, never piped: a piped stdout is capped by maxBuffer, and a
            // real server test run (migration logs) overflowed it with ENOBUFS on the ledger pilot.
            const result = spawnSync(command.argv[0], command.argv.slice(1), { cwd: root, stdio: json ? ['inherit', 2, 'inherit'] : 'inherit' });
            const status = result.error ? null : result.status;
            commands.push({ name: command.name, status, error: result.error ? result.error.message : null });
            if (status !== 0) break;
        }
    }
    return { findings, commands, capabilityBytes, receiptPath };
}

const KEYS_SCRIPT = `
const { createRequire } = require('node:module');
const target = process.argv.at(-1);
const esm = process.argv.at(-2) === 'esm';
if (!esm) process.stdout.write(JSON.stringify(Object.keys(createRequire(target)(target))));
else import(require('node:url').pathToFileURL(target).href).then((m) => process.stdout.write(JSON.stringify(Object.keys(m)))).catch((error) => { console.error(error && error.stack || error); process.exit(1); });
`;

const LOAD_SCRIPT = `
const [target, hostName] = process.argv.slice(-2);
import(target).then((m) => {
    const Host = m.default ?? m[hostName] ?? m;
    const kinds = (obj) => Object.getOwnPropertyNames(obj).map((name) => {
        const d = Object.getOwnPropertyDescriptor(obj, name);
        return [name, d.get || d.set ? 'accessor' : typeof d.value, d.enumerable];
    });
    process.stdout.write(JSON.stringify({ proto: kinds(Host.prototype), statics: kinds(Host) }));
}).catch((error) => { console.error(error && error.stack || error); process.exit(1); });
`;

module.exports = { verifyRecipe };
