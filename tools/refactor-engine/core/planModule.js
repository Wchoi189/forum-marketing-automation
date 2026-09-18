'use strict';

// `split-module` (contracts/generated-code.md §3 / §4, tasks T059): top-level declarations move to parts behind
// a facade that keeps the original export statement verbatim. Destinations are the parts, the facade and the
// shared part; every destination binds, from each other destination, exactly the names its own text reads, and
// a part exports only the names another destination uses. The destination graph is checked for cycles that are
// read at load: in ESM/TS a reference outside every function body; in CommonJS every reference, because
// `const { x } = require('…')` reads the export object the moment the part loads (research R17).

const path = require('node:path');
const { spanText, sha256 } = require('./inventory');
const { refusal, validateModuleRecipe } = require('./preconditions');
const { emitModulePart } = require('./emit/modulePart');
const { emitModuleFacade } = require('./emit/moduleFacade');
const { relativeSpecifier, stripExt } = require('./emit/blocks');
const { posixDir, resolveDir, rebaseStatement, importsAnchorFor, finishPlan, displayOf } = require('./planSupport');

const SHARED = '_shared';
const FACADE = 'facade';
const MOVABLE = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum']);
const PURE_KINDS = new Set(['const', 'function', 'class', 'interface', 'type', 'enum']);
const IMPORT = new Set(['import', 'require']);

// Every elementary cycle reachable over `edges` (Map node -> Set node), each reported once, rotated to start at
// the first non-facade node so the message names a part.
function findCycles(nodes, edges) {
    const cycles = [];
    const seen = new Set();
    const state = new Map();
    const stack = [];
    const visit = (node) => {
        state.set(node, 'active');
        stack.push(node);
        for (const next of edges.get(node) || []) {
            if (state.get(next) === 'active') {
                let cycle = stack.slice(stack.indexOf(next));
                const rotate = cycle.findIndex((n) => n !== FACADE);
                if (rotate > 0) cycle = [...cycle.slice(rotate), ...cycle.slice(0, rotate)];
                const key = [...cycle].sort().join('\0');
                if (!seen.has(key)) {
                    seen.add(key);
                    cycles.push(cycle);
                }
            } else if (!state.has(next)) visit(next);
        }
        stack.pop();
        state.set(node, 'done');
    };
    for (const node of nodes) if (!state.has(node)) visit(node);
    return cycles;
}

function planModule({ root, config, baseline, recipe, withPathReferences, sourceRel, text, fileExists, receiptPath, previousOutputs, inventory, sourceFile, ts }) {
    validateModuleRecipe(recipe, inventory);
    const { language, declarations, useStrict, newline } = inventory;
    const cjs = language === 'cjs';
    const ext = path.posix.extname(sourceRel);
    const sourceDir = posixDir(sourceRel);
    const sourceBasename = path.posix.basename(sourceRel);
    const refusals = [];
    const nameOf = (d) => d.names.join(', ');
    const label = (d) => nameOf(d) || `statement at line ${d.span.startLine}`;

    const targetDir = resolveDir(sourceDir, recipe.targetDirectory);
    const parts = recipe.parts.map((part) => {
        const dir = part.directory ? resolveDir(sourceDir, part.directory) : targetDir;
        return { name: part.name, dir, file: `${dir}/${part.name}${ext}`, declarationNames: part.declarations, declarations: [] };
    });
    const shared = { name: SHARED, dir: targetDir, file: `${targetDir}/${SHARED}${ext}`, declarations: [] };
    const facade = { name: FACADE, dir: sourceDir, file: sourceRel, declarations: [] };

    // ── Placement ────────────────────────────────────────────────────────────────────────────────────────────
    const declDest = new Map(); // declaration index -> destination name
    for (const d of declarations) declDest.set(d.index, FACADE);
    for (const part of parts) for (const d of declarations) if (d.names.some((n) => part.declarationNames.includes(n))) declDest.set(d.index, part.name);
    const pinned = new Set(declarations.filter((d) => d.names.some((n) => recipe.keep.includes(n))).map((d) => d.index));
    const movable = declarations.filter((d) => MOVABLE.has(d.kind));
    const pure = (d) => PURE_KINDS.has(d.kind) && !d.reassigned && !d.sideEffect;

    // Which destinations reference declaration `d`; every kept statement, the export statement included, counts
    // as the facade's.
    const users = (d) => {
        const out = new Map(); // destination -> [what references it]
        for (const other of declarations) {
            if (other.index === d.index || IMPORT.has(other.kind)) continue;
            if (!other.topLevelRefs.some((r) => r.declaration === d.index)) continue;
            const dest = declDest.get(other.index);
            if (!out.has(dest)) out.set(dest, []);
            out.get(dest).push(label(other));
        }
        return out;
    };

    // Hoisting (T047): an unlisted, unpinned pure declaration that a part reads goes to the shared part.
    for (let changed = true; changed; ) {
        changed = false;
        for (const d of movable) {
            if (declDest.get(d.index) !== FACADE || pinned.has(d.index) || !pure(d)) continue;
            if ([...users(d).keys()].some((dest) => dest !== FACADE)) {
                declDest.set(d.index, SHARED);
                changed = true;
            }
        }
    }
    for (const d of movable) {
        const home = declDest.get(d.index);
        const use = users(d);
        const others = [...use.keys()].filter((dest) => dest !== home);
        const by = others.map((dest) => `${use.get(dest).join(', ')} (${dest === SHARED ? 'shared part' : dest})`).join('; ');
        if (d.sideEffect && (others.length > 0 || home !== FACADE)) {
            refusals.push(refusal('RF-SIDE-EFFECT', nameOf(d), d.span.startLine, `${nameOf(d)} runs a load-time call; ${others.length > 0 ? `used by ${by}` : `moving it to ${home} reorders it`}`));
        } else if (!pure(d) && others.length > 0) {
            refusals.push(refusal('RF-MUTABLE-STATE', nameOf(d), d.span.startLine, `${nameOf(d)} is ${d.kind === 'const' ? 'reassigned' : d.kind} and is used from more than one destination: ${home}, ${others.join(', ')} (${by})`));
        }
    }
    for (const part of parts) part.declarations = declarations.filter((d) => declDest.get(d.index) === part.name);
    shared.declarations = declarations.filter((d) => declDest.get(d.index) === SHARED);
    facade.declarations = declarations.filter((d) => declDest.get(d.index) === FACADE && !IMPORT.has(d.kind));
    const destinations = [facade, ...parts, ...(shared.declarations.length > 0 ? [shared] : [])];
    const byName = new Map(destinations.map((dest) => [dest.name, dest]));
    const destOf = (index) => byName.get(declDest.get(index));

    // ── Bindings and the load graph ──────────────────────────────────────────────────────────────────────────
    // binding(from, to): the declarations of `to` that `from`'s text reads, in source order, split value/type.
    const binding = (from, to) => {
        const names = [];
        const typeNames = [];
        let load = false;
        const who = new Set();
        for (const d of to.declarations) {
            let used = false;
            for (const x of from.declarations) {
                for (const r of x.topLevelRefs) {
                    if (r.declaration !== d.index) continue;
                    used = true;
                    who.add(label(x));
                    if (r.loadTime && !d.typeOnly) load = true;
                }
            }
            if (!used) continue;
            (d.typeOnly ? typeNames : names).push(...d.names);
        }
        return { names, typeNames, load, who: [...who] };
    };
    const bindings = new Map(); // from name -> [{ to, names, typeNames, load, who }]
    const edges = new Map();
    for (const from of destinations) {
        bindings.set(from.name, []);
        edges.set(from.name, new Set());
        for (const to of destinations) {
            if (to === from) continue;
            const b = binding(from, to);
            bindings.get(from.name).push({ to, ...b });
            // The facade's generated block loads every part and the shared part; anything else is an edge only
            // when a value is read, and cycle-relevant at load (ESM/TS) or always (CommonJS destructuring).
            const structural = from === facade;
            if (structural || (b.names.length > 0 && (cjs || b.load))) edges.get(from.name).add(to.name);
        }
    }
    for (const cycle of findCycles(destinations.map((d) => d.name), edges)) {
        const [first, second] = cycle;
        const b = bindings.get(first).find((x) => x.to.name === (second ?? first));
        const reads = b && b.names.length > 0 ? `${b.who.join(', ')} reads ${b.names.join(', ')} from ${second}` : `${first} is loaded by ${second}`;
        const why = cjs ? 'a CommonJS part reads the export object when it requires, before the module that required it has assigned its own' : 'the reference is evaluated at load, before the module that loads it has run';
        refusals.push(refusal('RF-PART-CYCLE', first, 0, `${[...cycle, first].join(' → ')}: ${reads}; ${why}`));
    }

    // ── Refusals on parts ────────────────────────────────────────────────────────────────────────────────────
    for (const dest of destinations) {
        if (dest === facade) continue;
        if (dest.dir !== sourceDir) {
            for (const d of dest.declarations) for (const loc of d.locationSensitive) refusals.push(refusal('RF-LOCATION-SENSITIVE', nameOf(d), loc.line, `${nameOf(d)} reads ${loc.text}; ${dest.file} is not in the source directory, so its value would change`));
        }
        for (const d of dest.declarations) for (const dyn of d.dynamic) refusals.push(refusal('RF-DYNAMIC-REQUIRE', nameOf(d), dyn.line, `${nameOf(d)} calls ${dyn.text} with a non-literal specifier`));
        if (fileExists(dest.file) && !previousOutputs.has(dest.file)) refusals.push(refusal('RF-NAME-COLLISION', dest.name, 0, `${dest.file} already exists and is not this recipe's output`));
    }

    // ── Imports carried, imports removed from the facade ─────────────────────────────────────────────────────
    const refsOf = (content) => new Set(content.flatMap((x) => x.topLevelRefs.map((r) => r.declaration)));
    const importRecords = declarations.filter((d) => IMPORT.has(d.kind));
    const carriedFor = (dest) => {
        const refs = refsOf(dest.declarations);
        return importRecords.filter((imp) => refs.has(imp.index)).map((record) => ({ names: record.names, text: rebaseStatement(ts, sourceFile, text, record, sourceDir, dest.dir) }));
    };
    const facadeRefs = refsOf(facade.declarations);
    const movedRefs = refsOf(destinations.filter((d) => d !== facade).flatMap((d) => d.declarations));
    const removedImports = importRecords.filter((imp) => movedRefs.has(imp.index) && !facadeRefs.has(imp.index));
    const keptImports = importRecords.filter((imp) => !removedImports.includes(imp));

    // ── Emission ─────────────────────────────────────────────────────────────────────────────────────────────
    const specifier = (fromDir, toFile) => {
        const display = relativeSpecifier(fromDir, toFile);
        return { display, specifier: stripExt(display) };
    };
    const files = new Map();
    const moves = [];
    const rowSpecs = [];
    const exportsOf = (dest) => {
        // Names other destinations read from `dest`, in source order; ESM/TS skip names their own declaration exports.
        const wanted = new Set(destinations.filter((d) => d !== dest).flatMap((d) => bindings.get(d.name).find((b) => b.to === dest)).flatMap((b) => [...b.names, ...b.typeNames]));
        const out = { exportNames: [], exportTypeNames: [] };
        for (const d of dest.declarations) {
            if (!cjs && d.exported) continue;
            for (const n of d.names) if (wanted.has(n)) (d.typeOnly ? out.exportTypeNames : out.exportNames).push(n);
        }
        return out;
    };
    for (const dest of destinations) {
        if (dest === facade) continue;
        const imports = carriedFor(dest);
        const bound = bindings.get(dest.name).filter((b) => b.names.length > 0 || b.typeNames.length > 0).map((b) => ({ ...b, ...specifier(dest.dir, b.to.file) }));
        const { exportNames, exportTypeNames } = exportsOf(dest);
        files.set(dest.file, emitModulePart({
            language, useStrict, newline, sourceBasename, recipeName: recipe.name, shared: dest === shared, imports, bindings: bound,
            declarations: dest.declarations.map((d) => ({ text: spanText(text, d.span) })), exportNames, exportTypeNames,
        }));
        for (const d of dest.declarations) moves.push({ name: nameOf(d), kind: d.kind, static: false, from: { startLine: d.span.startLine, endLine: d.span.endLine }, to: dest.file, sha256: sha256(spanText(text, d.span)) });
        rowSpecs.push({ destination: displayOf(sourceDir, dest.file), file: dest.file, extra: {
            members: [], declarations: dest.declarations.map(nameOf), imports: imports.map((i) => i.names.join(', ')), hoisted: dest === shared ? dest.declarations.flatMap((d) => d.names) : [],
            hostBinding: false, shared: dest === shared ? [] : (bindings.get(dest.name).find((b) => b.to === shared) || { names: [] }).names, exports: [...exportNames, ...exportTypeNames],
        } });
    }
    const facadeBindings = destinations.filter((d) => d !== facade).map((dest) => {
        const b = bindings.get(FACADE).find((x) => x.to === dest);
        const exported = cjs ? [] : dest.declarations.filter((d) => d.exported);
        return {
            ...specifier(sourceDir, dest.file),
            importNames: b.names, importTypeNames: b.typeNames,
            exportNames: exported.filter((d) => !d.typeOnly).flatMap((d) => d.names), exportTypeNames: exported.filter((d) => d.typeOnly).flatMap((d) => d.names),
        };
    });
    const importsAnchor = importsAnchorFor({ keptImports, declarations, language, newline });
    const removals = [...destinations.filter((d) => d !== facade).flatMap((d) => d.declarations.map((x) => x.span)), ...removedImports.map((d) => d.span)];
    const emitted = emitModuleFacade({ language, text, newline, importsAnchor, removals, bindings: facadeBindings });
    files.set(sourceRel, emitted.text);
    const generated = Object.entries(emitted.blocks).map(([block, blockText]) => ({ file: sourceRel, block, sha256: sha256(blockText.replace(/\r\n/g, '\n')) }));
    rowSpecs.unshift({ destination: `(facade) ${sourceBasename}`, file: sourceRel, extra: {
        members: [], declarations: facade.declarations.filter((d) => d.names.length > 0).map(nameOf), imports: keptImports.map((d) => d.names.join(', ')), hoisted: [],
        hostBinding: false, shared: (bindings.get(FACADE).find((b) => b.to === shared) || { names: [] }).names, exports: [],
    } });
    return finishPlan({ root, config, baseline, recipe, sourceRel, inventory, text, ext, host: null, rowSpecs, files, refusals, moves, generated, receiptPath, withPathReferences });
}

module.exports = { planModule };
