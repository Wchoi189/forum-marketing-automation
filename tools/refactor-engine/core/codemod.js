'use strict';

// `codemod`: a declarative rewrite (a GritQL pattern) run to a fixpoint over a selection of files, with every
// output checked before anything is written. A codemod is a directory:
//
//   <dir>/codemod.json        metadata (schema refactor-engine/codemod/1)
//   <dir>/<pattern>.grit      the pattern, self-contained (no stdlib), with a `language` line
//   <dir>/fixtures/<case>/    input.<ext> plus expected.<ext> (positive), nothing else (negative: must not change),
//                             or a `refusal` file naming the refusal code the case must produce
//
// `run` refuses to touch the tree unless every fixture passes, and is a dry run unless --write is given.

const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const { usageError } = require('./errors');
const { listFiles, readIndex, stagedPaths, toPosix } = require('./repo');
const { patternApplies } = require('./scope');
const grit = require('./grit');
const { unifiedPatch, restoreIndentation, syntaxError } = require('./codemodText');

const SCHEMA = 'refactor-engine/codemod/1';
const RECEIPT_SCHEMA = 'refactor-engine/codemod-receipt/1';
const INDENTATION = ['restore', 'engine'];
const DEFAULT_MAX_PASSES = 5;

// codemod.json alone: no pattern read, no engine loaded. The catalog (audit's fix hints, `codemod list`) stops here.
function readCodemodMeta(dir, readFile) {
    const metaPath = path.posix.join(dir, 'codemod.json');
    return cfg.withSource(`codemod ${metaPath}`, () => {
        const raw = cfg.expectObject(cfg.readJson(readFile, metaPath, 'codemod'), 'codemod');
        cfg.onlyKeys(raw, ['$schema', 'id', 'engine', 'pattern', 'why', 'include', 'exclude', 'ratchet', 'maxPasses', 'indentation', 'review', 'postconditions'], '');
        cfg.required(raw, ['$schema', 'id', 'engine', 'pattern', 'why', 'include'], '');
        if (raw.$schema !== SCHEMA) throw usageError(`$schema must be "${SCHEMA}"`);
        if (typeof raw.id !== 'string' || !cfg.KEBAB.test(raw.id)) throw usageError('id must be kebab-case');
        if (raw.engine !== 'grit') throw usageError('engine must be "grit"');
        cfg.nonEmptyString(raw.why, 'why');
        if (raw.indentation !== undefined && !INDENTATION.includes(raw.indentation)) throw usageError(`indentation must be one of ${INDENTATION.join(', ')}`);
        return {
            dir,
            id: raw.id,
            why: raw.why,
            patternPath: path.posix.join(dir, cfg.nonEmptyString(raw.pattern, 'pattern')),
            include: cfg.stringArray(raw.include, 'include', { nonEmpty: true }),
            exclude: raw.exclude === undefined ? [] : cfg.stringArray(raw.exclude, 'exclude'),
            ratchet: raw.ratchet === undefined ? null : cfg.nonEmptyString(raw.ratchet, 'ratchet'),
            maxPasses: raw.maxPasses === undefined ? DEFAULT_MAX_PASSES : cfg.positiveInteger(raw.maxPasses, 'maxPasses'),
            indentation: raw.indentation ?? 'restore',
            review: raw.review === undefined ? [] : cfg.stringArray(raw.review, 'review'),
            postconditions: parsePostconditions(raw.postconditions),
        };
    });
}

// A postcondition names text that must not survive the rewrite anywhere in its file set: a rename that parses but
// misses a declaration form leaves the old name behind, and a clean parse is not evidence it did not.
function parsePostconditions(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw usageError('postconditions must be an array');
    return value.map((entry, index) => {
        const where = `postconditions[${index}]`;
        cfg.expectObject(entry, where);
        cfg.onlyKeys(entry, ['absent', 'include', 'exclude', 'why'], where);
        cfg.required(entry, ['absent', 'include', 'why'], where);
        let regex;
        try {
            regex = new RegExp(cfg.nonEmptyString(entry.absent, `${where}.absent`));
        } catch (error) {
            throw usageError(`${where}.absent does not compile: ${error.message}`);
        }
        return {
            absent: entry.absent,
            regex,
            include: cfg.stringArray(entry.include, `${where}.include`, { nonEmpty: true }),
            exclude: entry.exclude === undefined ? [] : cfg.stringArray(entry.exclude, `${where}.exclude`),
            why: cfg.nonEmptyString(entry.why, `${where}.why`),
        };
    });
}

function loadCodemod(dirArg, { root }) {
    const dir = toPosix(path.relative(root, path.resolve(root, dirArg))) || '.';
    const readFile = cfg.defaultReader(root);
    const meta = readCodemodMeta(dir, readFile);
    const source = readFile(meta.patternPath);
    if (source === null) throw usageError(`codemod ${dir}/codemod.json: pattern not found: ${meta.patternPath}`);
    return { ...meta, source: grit.validatePatternSource(source, `pattern ${meta.patternPath}`), patternHash: grit.hashOf(source) };
}

const refusal = (code, message) => ({ code, message });

// One file through the pipeline: engine passes to a fixpoint, indentation, then the introduced-syntax-error check.
async function transform(binding, codemod, relPath, text) {
    let current = text;
    let passes = 0;
    let restored = 0;
    for (;;) {
        let next = await grit.applyPattern(binding, codemod.source, relPath, current);
        if (next === null) break;
        if (passes === codemod.maxPasses) {
            return { status: 'refused', passes, refusal: refusal('CM-NO-FIXPOINT', `still changing after maxPasses ${codemod.maxPasses}`) };
        }
        passes += 1;
        // Per pass, so the next pass inserts relative to restored lines rather than the engine's column 0.
        if (codemod.indentation === 'restore') {
            const pass = restoreIndentation(relPath, current, next);
            next = pass.text;
            restored += pass.restored;
        }
        current = next;
    }
    if (current === text) return { status: 'unchanged', passes: 0 };
    const sourceError = syntaxError(relPath, text);
    if (sourceError !== null) {
        return { status: 'refused', passes, refusal: refusal('CM-SOURCE-UNPARSED', `the source does not parse before rewriting: ${sourceError}`) };
    }
    const introduced = syntaxError(relPath, current);
    if (introduced !== null) return { status: 'refused', passes, refusal: refusal('CM-SYNTAX', `the rewrite does not parse: ${introduced}`) };
    return { status: 'changed', passes, restored, text: current };
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

function fixtureCases(root, codemod) {
    const base = path.join(root, codemod.dir, 'fixtures');
    const names = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
    const cases = names.map((name) => {
        const files = fs.readdirSync(path.join(base, name));
        const input = files.filter((f) => /^input\.[A-Za-z]+$/.test(f));
        if (input.length !== 1) throw usageError(`fixture ${codemod.id}/${name} must hold exactly one input.<ext>`);
        const ext = path.extname(input[0]);
        const read = (file) => fs.readFileSync(path.join(base, name, file), 'utf8');
        if (files.includes(`expected${ext}`)) return { name, kind: 'positive', file: `input${ext}`, input: read(input[0]), expected: read(`expected${ext}`) };
        if (files.includes('refusal')) return { name, kind: 'refusal', file: `input${ext}`, input: read(input[0]), expected: read('refusal').trim() };
        return { name, kind: 'negative', file: `input${ext}`, input: read(input[0]) };
    });
    for (const kind of ['positive', 'negative']) {
        if (!cases.some((c) => c.kind === kind)) throw usageError(`codemod ${codemod.id} needs at least one ${kind} fixture under ${codemod.dir}/fixtures/`);
    }
    return cases;
}

async function testCodemod(binding, root, codemod) {
    const results = [];
    for (const c of fixtureCases(root, codemod)) {
        const out = await transform(binding, codemod, c.file, c.input);
        let failure = null;
        if (c.kind === 'positive') {
            if (out.status !== 'changed') failure = `expected a rewrite, got ${out.status}${out.refusal ? ` (${out.refusal.code}: ${out.refusal.message})` : ''}`;
            else if (out.text !== c.expected) failure = `output differs from expected:\n${unifiedPatch(c.file, c.expected, out.text)}`;
        } else if (c.kind === 'negative') {
            if (out.status !== 'unchanged') failure = `expected no change, got ${out.status}${out.text ? `:\n${unifiedPatch(c.file, c.input, out.text)}` : ''}`;
        } else if (out.status !== 'refused' || out.refusal.code !== c.expected) {
            failure = `expected refusal ${c.expected}, got ${out.status}${out.refusal ? ` ${out.refusal.code}` : ''}`;
        }
        results.push({ codemod: codemod.id, fixture: c.name, kind: c.kind, ok: failure === null, failure });
    }
    return results;
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────────────────

function selectFiles(root, codemod, { staged, paths }) {
    const applies = (p) => patternApplies(p, codemod);
    if (staged) return stagedPaths(root).filter(applies);
    if (paths.length > 0) {
        return paths.map((given) => {
            const relPath = toPosix(path.relative(root, path.resolve(root, given)));
            if (relPath.startsWith('..')) throw usageError(`${given} is outside the root ${root}`);
            if (!fs.existsSync(path.join(root, relPath))) throw usageError(`${relPath} does not exist`);
            return relPath;
        }).filter(applies);
    }
    return listFiles(root).filter((p) => applies(p) && fs.existsSync(path.join(root, p)));
}

// Each postcondition over the tree as it will be: rewritten text for changed files, the worktree for every other path.
function evaluatePostconditions(root, codemod, rewritten) {
    if (codemod.postconditions.length === 0) return [];
    const candidates = [...new Set([...listFiles(root), ...rewritten.keys()])].sort();
    return codemod.postconditions.map((pc) => {
        const hits = [];
        for (const relPath of candidates.filter((p) => patternApplies(p, pc))) {
            let text = rewritten.get(relPath);
            if (text === undefined) {
                const full = path.join(root, relPath);
                if (!fs.existsSync(full)) continue;
                text = fs.readFileSync(full, 'utf8');
            }
            text.split('\n').forEach((line, index) => {
                if (pc.regex.test(line)) hits.push({ path: relPath, line: index + 1, text: line.trim() });
            });
        }
        return { absent: pc.absent, why: pc.why, hits };
    });
}

async function runCodemod({ root, config, baseline = null, codemod, paths = [], staged = false, write = false }) {
    const binding = grit.loadGrit();
    const fixtures = await testCodemod(binding, root, codemod);
    if (fixtures.some((f) => !f.ok)) return { fixtures, files: [], patch: '', ratchet: null, ratchetFindings: [], postconditions: [], written: [] };

    let ratchetRule = null;
    if (codemod.ratchet !== null) {
        ratchetRule = config.patterns.find((p) => p.id === codemod.ratchet);
        if (!ratchetRule) throw usageError(`codemod ${codemod.id}: ratchet "${codemod.ratchet}" is not a pattern in the host config`);
    }
    const { measure } = require('./metrics');
    const count = (relPath, text) => measure(relPath, text, { ...config, patterns: [ratchetRule] }).patterns[ratchetRule.id] ?? 0;

    const files = [];
    let patch = '';
    for (const relPath of selectFiles(root, codemod, { staged, paths })) {
        const text = staged ? readIndex(root, relPath) : fs.readFileSync(path.join(root, relPath), 'utf8');
        if (text === null) continue;
        const out = await transform(binding, codemod, relPath, text);
        if (out.status === 'unchanged') continue;
        const entry = { path: relPath, status: out.status, passes: out.passes, before: grit.hashOf(text) };
        if (out.status === 'refused') {
            files.push({ ...entry, refusal: out.refusal });
            continue;
        }
        if (staged && write && fs.readFileSync(path.join(root, relPath), 'utf8') !== text) {
            files.push({ ...entry, status: 'refused', refusal: refusal('CM-PARTIALLY-STAGED', 'the worktree differs from the index; stage or stash first') });
            continue;
        }
        entry.after = grit.hashOf(out.text);
        entry.restoredLines = out.restored;
        if (ratchetRule) entry.ratchet = { before: count(relPath, text), after: count(relPath, out.text) };
        patch += unifiedPatch(relPath, text, out.text);
        files.push({ ...entry, text: out.text });
    }

    const changed = files.filter((f) => f.status === 'changed');
    // What `audit` will say once the rewrite lands: a codemod that burns one pattern can grow a file or a function
    // (a hoisted statement adds its declaration line), and that is visible here, before --write, not at commit.
    let ratchetFindings = [];
    if (baseline !== null && changed.length > 0) {
        const { evaluate } = require('./ratchet');
        const { inScope } = require('./scope');
        const measured = new Map();
        for (const f of changed.filter((c) => inScope(c.path, config))) {
            const m = measure(f.path, f.text, config);
            measured.set(f.path, { lines: m.lines, maxFunction: m.maxFunction, patterns: m.patterns });
        }
        ratchetFindings = evaluate({ measured, baseline, limits: config.limits, fullRun: false, existing: new Set(measured.keys()) }).findings;
    }
    const ratchet = ratchetRule
        ? { id: ratchetRule.id, before: changed.reduce((n, f) => n + f.ratchet.before, 0), after: changed.reduce((n, f) => n + f.ratchet.after, 0) }
        : null;
    const postconditions = evaluatePostconditions(root, codemod, new Map(changed.map((f) => [f.path, f.text])));
    const blocked = postconditions.some((pc) => pc.hits.length > 0);
    const written = [];
    if (write && !blocked) {
        for (const f of changed) {
            fs.writeFileSync(path.join(root, f.path), f.text);
            written.push(f.path);
        }
    }
    return { fixtures, files: files.map(({ text, ...rest }) => rest), patch, ratchet, ratchetFindings, postconditions, written };
}

function buildCodemodReceipt({ codemod, result, now = new Date() }) {
    const { isoWithOffset } = require('./receipt');
    return {
        $schema: RECEIPT_SCHEMA,
        codemod: codemod.id,
        pattern: { path: codemod.patternPath, hash: codemod.patternHash },
        engine: grit.engineVersion(),
        appliedAt: isoWithOffset(now),
        ratchet: result.ratchet,
        ...(result.postconditions.length > 0 ? { postconditions: result.postconditions.map((pc) => ({ absent: pc.absent, hits: pc.hits.length })) } : {}),
        files: result.files
            .filter((f) => f.status === 'changed')
            .map((f) => ({ path: f.path, before: f.before, after: f.after, passes: f.passes, ...(f.ratchet ? { ratchet: f.ratchet } : {}) })),
    };
}

module.exports = { SCHEMA, readCodemodMeta, loadCodemod, transform, testCodemod, runCodemod, buildCodemodReceipt };
