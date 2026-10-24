'use strict';

// recipe + inventory → MovePlan (data-model.md §3). Decides where every member and top-level declaration lands
// (facade, a part, or the shared part), which imports each destination carries, emits every file into memory,
// measures the ratchet effect and lists path references. Nothing here writes. `split-class` is planned here;
// `split-module` in planModule.js; what they share is in planSupport.js.

const path = require('node:path');
const { usageError } = require('./errors');
const { inventoryFile, spanText, sha256 } = require('./inventory');
const { validateRecipe, checkMembers, refusal } = require('./preconditions');
const { emitClassPart, emitSharedPart } = require('./emit/classPart');
const { emitClassFacade } = require('./emit/classFacade');
const { relativeSpecifier, stripExt } = require('./emit/blocks');
const { normalizePath, worktreeReader } = require('./audit');
const { readReceipt, receiptPathFor, movesApplied } = require('./receipt');
const { posixDir, resolveDir, rebaseStatement, importsAnchorFor, finishPlan, displayOf } = require('./planSupport');
const { planModule } = require('./planModule');

const SHARED = '_shared';
const MOVABLE = new Set(['const', 'let', 'var', 'function', 'class']);
const IMPORT = new Set(['import', 'require']);

function buildPlan({ root, config, baseline, recipe, withPathReferences = true }) {
    const read = worktreeReader(root);
    const sourceRel = normalizePath(root, recipe.source);
    const text = read(sourceRel);
    if (text === null) throw usageError(`source ${sourceRel} does not exist`);
    const fileExists = (rel) => read(rel) !== null;

    // Idempotent re-plan: a receipt whose every move is found in place means there is nothing to move.
    const receiptPath = receiptPathFor(config, recipe);
    const receipt = readReceipt(root, receiptPath);
    if (receipt && receipt.source.path === sourceRel && movesApplied(root, receipt)) {
        return { nothingToMove: true, recipe: recipe.name, receipt: receiptPath, refusals: [], rows: [], pathReferences: [], ratchetEffect: null, files: new Map() };
    }
    const previousOutputs = new Set(receipt ? receipt.moves.map((m) => m.to) : []);

    const { inventory, sourceFile, ts } = inventoryFile(root, sourceRel, text);
    const context = { root, config, baseline, recipe, withPathReferences, sourceRel, text, fileExists, receiptPath, previousOutputs, inventory, sourceFile, ts };
    if (recipe.strategy === 'split-class') return planClass(context);
    if (recipe.strategy === 'split-module') return planModule(context);
    throw usageError(`strategy ${recipe.strategy} is not implemented yet`);
}

function planClass({ root, config, baseline, recipe, withPathReferences, sourceRel, text, fileExists, receiptPath, previousOutputs, inventory, sourceFile, ts }) {
    const host = validateRecipe(recipe, inventory);
    const { language, declarations } = inventory;
    const ext = path.posix.extname(sourceRel);
    const sourceDir = posixDir(sourceRel);
    const refusals = [];
    if (language === 'ts' || language === 'tsx') refusals.push(refusal('RF-TS-CLASS', recipe.host, host.span.startLine, `${sourceRel} is TypeScript`));

    const targetDir = resolveDir(sourceDir, recipe.targetDirectory);
    const parts = recipe.parts.map((part) => {
        const dir = part.directory ? resolveDir(sourceDir, part.directory) : targetDir;
        return { name: part.name, dir, file: `${dir}/${part.name}${ext}`, memberNames: part.members, declarationNames: part.declarations, members: [], declarations: [], imports: [], shared: [], hostBinding: false };
    });

    // ── Placement ────────────────────────────────────────────────────────────────────────────────────────────
    const memberDest = new Map(); // member index -> destination
    for (const member of host.members) memberDest.set(member.index, 'facade');
    for (const part of parts) {
        for (const member of host.members) if (part.memberNames.includes(member.name)) memberDest.set(member.index, part.name);
    }
    const declDest = new Map(); // declaration index -> destination
    for (const record of declarations) declDest.set(record.index, 'facade');
    for (const part of parts) {
        for (const record of declarations) if (record.names.some((n) => part.declarationNames.includes(n))) declDest.set(record.index, part.name);
    }
    const movable = declarations.filter((d) => MOVABLE.has(d.kind) && d.index !== host.index);
    const pure = (d) => (d.kind === 'const' || d.kind === 'function' || d.kind === 'class') && !d.reassigned && !d.sideEffect;
    const nameOf = (d) => d.names.join(', ');

    // Which destinations reference declaration `d`: moved and kept members, other declarations (wherever they
    // now sit), post-class and other statements (facade), and the class heritage (facade and every part).
    const users = (d) => {
        const out = new Map(); // destination -> [what references it]
        const add = (dest, who) => {
            if (!out.has(dest)) out.set(dest, []);
            out.get(dest).push(who);
        };
        for (const member of host.members) if (member.topLevelRefs.some((r) => r.declaration === d.index)) add(memberDest.get(member.index), `${member.name}()`);
        for (const other of declarations) {
            if (other.index === d.index || other.index === host.index) continue;
            if (other.topLevelRefs.some((r) => r.declaration === d.index)) add(declDest.get(other.index), nameOf(other) || `statement at line ${other.span.startLine}`);
        }
        if (host.baseRefs.some((r) => r.declaration === d.index)) {
            add('facade', `class ${host.name} extends`);
            for (const part of parts) add(part.name, `class ${part.name} extends`);
        }
        return out;
    };

    for (let changed = true; changed; ) {
        changed = false;
        for (const d of movable) {
            const home = declDest.get(d.index);
            const others = [...users(d).keys()].filter((dest) => dest !== home);
            if (others.length === 0 || !pure(d)) continue;
            if (home !== 'facade' && home !== SHARED) {
                throw usageError(`parts (${home}): "${nameOf(d)}" is listed in declarations but is also used by ${others.join(', ')}; remove it from declarations and it is hoisted to the shared part`);
            }
            if (home === 'facade') {
                declDest.set(d.index, SHARED);
                changed = true;
            }
        }
    }
    for (const d of movable) {
        const home = declDest.get(d.index);
        const use = users(d);
        const others = [...use.keys()].filter((dest) => dest !== home);
        const by = others.map((dest) => `${use.get(dest).join(', ')} (${dest === 'facade' ? 'facade' : dest === SHARED ? 'shared part' : dest})`).join('; ');
        if (d.sideEffect && (others.length > 0 || home !== 'facade')) {
            refusals.push(refusal('RF-SIDE-EFFECT', nameOf(d), d.span.startLine, `${nameOf(d)} runs a load-time call; ${others.length > 0 ? `used by ${by}` : `moving it to ${home} reorders it`}`));
        } else if (!pure(d) && others.length > 0) {
            refusals.push(refusal('RF-MUTABLE-STATE', nameOf(d), d.span.startLine, `${nameOf(d)} is ${d.kind === 'const' ? 'reassigned' : d.kind} and is used from more than one destination: ${home === 'facade' ? 'facade' : home}, ${others.join(', ')} (${by})`));
        }
        if (home === SHARED && d.hostRefs) {
            refusals.push({ ...refusal('RF-PART-CYCLE', nameOf(d), d.span.startLine, `${nameOf(d)} would be hoisted to the shared part but references ${host.name}; the shared part loads before the facade exports it`), wayForward: 'keep it in the facade, or list it in the one part that uses it' });
        }
    }

    const shared = { names: [], declarations: declarations.filter((d) => declDest.get(d.index) === SHARED), file: `${targetDir}/${SHARED}${ext}`, dir: targetDir };
    shared.names = shared.declarations.flatMap((d) => d.names);

    // ── Content per destination ──────────────────────────────────────────────────────────────────────────────
    for (const part of parts) {
        part.members = host.members.filter((m) => memberDest.get(m.index) === part.name);
        part.declarations = declarations.filter((d) => declDest.get(d.index) === part.name);
        part.hostBinding = [...part.members, ...part.declarations].some((x) => x.hostRefs);
    }
    const facadeMembers = host.members.filter((m) => memberDest.get(m.index) === 'facade');
    const facadeDeclarations = declarations.filter((d) => declDest.get(d.index) === 'facade' && d.index !== host.index);

    const refsOf = (content) => new Set(content.flatMap((x) => x.topLevelRefs.map((r) => r.declaration)));
    const importRecords = declarations.filter((d) => IMPORT.has(d.kind));
    const baseImports = new Set(host.baseRefs.map((r) => r.declaration));
    const carriedFor = (content, { withBase }) => {
        const refs = refsOf(content);
        return importRecords.filter((imp) => refs.has(imp.index) || (withBase && baseImports.has(imp.index)));
    };
    const sharedFor = (content) => {
        const refs = refsOf(content);
        return shared.declarations.filter((d) => refs.has(d.index)).flatMap((d) => d.names);
    };
    for (const part of parts) {
        const content = [...part.members, ...part.declarations];
        part.imports = carriedFor(content, { withBase: true }).map((record) => ({ names: record.names, text: rebaseStatement(ts, sourceFile, text, record, sourceDir, part.dir) }));
        part.shared = sharedFor(content);
    }
    shared.imports = carriedFor(shared.declarations, { withBase: false }).map((record) => ({ names: record.names, text: rebaseStatement(ts, sourceFile, text, record, sourceDir, shared.dir) }));
    const facadeContent = [...facadeMembers, ...facadeDeclarations];
    const facadeRefs = refsOf(facadeContent);
    for (const r of host.baseRefs) facadeRefs.add(r.declaration);
    const movedRefs = refsOf([...parts.flatMap((p) => [...p.members, ...p.declarations]), ...shared.declarations]);
    const removedImports = importRecords.filter((imp) => movedRefs.has(imp.index) && !facadeRefs.has(imp.index));
    const facadeShared = sharedFor(facadeContent);

    // ── Refusals on members and parts ────────────────────────────────────────────────────────────────────────
    refusals.push(...checkMembers({ recipe, inventory, sourceDir, parts, fileExists, previousOutputs }));
    if (shared.declarations.length > 0 && fileExists(shared.file) && !previousOutputs.has(shared.file)) {
        refusals.push(refusal('RF-NAME-COLLISION', SHARED, 0, `${shared.file} already exists and is not this recipe's output`));
    }
    if (shared.declarations.length > 0 && shared.dir !== sourceDir) {
        for (const d of shared.declarations) for (const loc of d.locationSensitive) refusals.push(refusal('RF-LOCATION-SENSITIVE', nameOf(d), loc.line, `${nameOf(d)} reads ${loc.text} and would be hoisted to ${shared.file}, outside the source directory`));
    }

    // ── Emission ─────────────────────────────────────────────────────────────────────────────────────────────
    const { useStrict, indent, newline } = inventory;
    const sourceBasename = path.posix.basename(sourceRel);
    const files = new Map();
    const moves = [];
    const partBlocks = [];
    const hasStatic = parts.some((p) => p.members.some((m) => m.static));
    const sharedFileFor = (dir) => ({ names: [], display: relativeSpecifier(dir, shared.file), specifier: stripExt(relativeSpecifier(dir, shared.file)) });
    for (const part of parts) {
        const sharedRef = sharedFileFor(part.dir);
        sharedRef.names = part.shared;
        const facadeDisplay = relativeSpecifier(part.dir, sourceRel);
        const content = emitClassPart({
            language, useStrict, indent, newline, sourceBasename, recipeName: recipe.name, host: host.name, hostExport: inventory.hostExport,
            facadeDisplay, facadeSpecifier: stripExt(facadeDisplay), part: part.name, base: host.base, imports: part.imports, hostBinding: part.hostBinding,
            shared: sharedRef, declarations: part.declarations.map((d) => ({ text: spanText(text, d.span) })), members: part.members.map((m) => ({ text: spanText(text, m.span) })),
        });
        files.set(part.file, content);
        for (const m of part.members) moves.push({ name: m.name, kind: m.kind, static: m.static, from: { startLine: m.span.startLine, endLine: m.span.endLine }, to: part.file, sha256: sha256(spanText(text, m.span)) });
        for (const d of part.declarations) moves.push({ name: nameOf(d), kind: d.kind, static: false, from: { startLine: d.span.startLine, endLine: d.span.endLine }, to: part.file, sha256: sha256(spanText(text, d.span)) });
        const display = relativeSpecifier(sourceDir, part.file);
        partBlocks.push({ name: part.name, names: part.members.map((m) => m.name), display, specifier: stripExt(display) });
    }
    if (shared.declarations.length > 0) {
        files.set(shared.file, emitSharedPart({ language, useStrict, newline, sourceBasename, recipeName: recipe.name, imports: shared.imports, declarations: shared.declarations.map((d) => ({ text: spanText(text, d.span) })), exportNames: shared.names }));
        for (const d of shared.declarations) moves.push({ name: nameOf(d), kind: d.kind, static: false, from: { startLine: d.span.startLine, endLine: d.span.endLine }, to: shared.file, sha256: sha256(spanText(text, d.span)) });
    }

    const keptImports = importRecords.filter((imp) => !removedImports.includes(imp));
    const importsAnchor = importsAnchorFor({ keptImports, declarations, language, newline });
    const removals = [
        ...parts.flatMap((p) => [...p.members, ...p.declarations].map((x) => x.span)),
        ...shared.declarations.map((d) => d.span),
        ...removedImports.map((d) => d.span),
    ];
    const facadeSharedRef = sharedFileFor(sourceDir);
    facadeSharedRef.names = facadeShared;
    const facade = emitClassFacade({ language, text, indent, newline, host: host.name, classEnd: host.bodyEnd, importsAnchor, removals, parts: partBlocks, hasStatic, shared: facadeSharedRef });
    files.set(sourceRel, facade.text);
    const generated = Object.entries(facade.blocks).map(([block, blockText]) => ({ file: sourceRel, block, sha256: sha256(blockText.replace(/\r\n/g, '\n')) }));

    const rowSpecs = [{ destination: `(facade) ${sourceBasename}`, file: sourceRel, extra: { members: facadeMembers.map((m) => m.name), imports: keptImports.map((d) => d.names.join(', ')), hoisted: [], hostBinding: false, shared: facadeShared } }];
    for (const part of parts) rowSpecs.push({ destination: displayOf(sourceDir, part.file), file: part.file, extra: { members: part.members.map((m) => m.name), declarations: part.declarations.map(nameOf), imports: part.imports.map((i) => i.names.join(', ')), hoisted: [], hostBinding: part.hostBinding, shared: part.shared } });
    if (shared.declarations.length > 0) rowSpecs.push({ destination: displayOf(sourceDir, shared.file), file: shared.file, extra: { members: [], declarations: shared.names, imports: shared.imports.map((i) => i.names.join(', ')), hoisted: shared.names, hostBinding: false, shared: [] } });
    return finishPlan({ root, config, baseline, recipe, sourceRel, inventory, text, ext, host: host.name, rowSpecs, files, refusals, moves, generated, receiptPath, withPathReferences });
}

module.exports = { buildPlan };
