'use strict';

// Host config, recipe and baseline loaders (contracts/recipe-and-config.md). Every unknown key, at any depth, is
// exit 4: a typo must never be silently ignored. `readFile` is injectable so `audit --staged` can hand in an
// index reader and judge a commit against the config and baseline it actually stages.

const fs = require('node:fs');
const path = require('node:path');
const { ToolkitError, EXIT, usageError } = require('./errors');
const { requireFromToolkit } = require('./deps');

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const AST_GREP_LANGUAGES = { javascript: 'JavaScript', typescript: 'TypeScript', tsx: 'Tsx' };
const STRATEGIES = ['split-class', 'split-module'];
const ACCEPTABLE_CODES = ['RF-COMPUTED-THIS'];

function defaultReader(root) {
    return (relPath) => {
        try {
            return fs.readFileSync(path.resolve(root, relPath), 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw usageError(`cannot read ${relPath}: ${error.message}`);
        }
    };
}

function readJson(readFile, relPath, what) {
    const text = readFile(relPath);
    if (text === null) throw usageError(`${what} not found: ${relPath}`);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw usageError(`${what} ${relPath} is not valid JSON: ${error.message}`);
    }
}

const key = (where, name) => (where ? `${where}.${name}` : name);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function expectObject(value, where) {
    if (!isObject(value)) throw usageError(`${where} must be an object`);
    return value;
}

function onlyKeys(obj, allowed, where) {
    for (const name of Object.keys(obj)) {
        if (!allowed.includes(name)) throw usageError(`unknown key ${key(where, name)}`);
    }
}

function required(obj, names, where) {
    for (const name of names) {
        if (!(name in obj)) throw usageError(`missing required key ${key(where, name)}`);
    }
}

function nonEmptyString(value, where) {
    if (typeof value !== 'string' || value.trim() === '') throw usageError(`${where} must be a non-empty string`);
    return value;
}

function stringArray(value, where, { nonEmpty = false } = {}) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
        throw usageError(`${where} must be an array of non-empty strings`);
    }
    if (nonEmpty && value.length === 0) throw usageError(`${where} must not be empty`);
    return value;
}

function positiveInteger(value, where) {
    if (!Number.isInteger(value) || value <= 0) throw usageError(`${where} must be a positive integer`);
    return value;
}

// Prefix a validation message with the file it came from, once.
function withSource(label, fn) {
    try {
        return fn();
    } catch (error) {
        if (error instanceof ToolkitError && error.exitCode === EXIT.USAGE && !error.message.startsWith(label)) {
            error.message = `${label}: ${error.message}`;
        }
        throw error;
    }
}

// ── Host config ─────────────────────────────────────────────────────────────────────────────────────────────

function validatePattern(pattern, index, ids, readFile) {
    const where = `patterns[${index}]`;
    expectObject(pattern, where);
    onlyKeys(pattern, ['id', 'kind', 'why', 'include', 'exclude', 'regex', 'rule', 'ruleFile', 'language'], where);
    if (typeof pattern.id !== 'string' || !KEBAB.test(pattern.id)) throw usageError(`${where}.id must be kebab-case`);
    if (ids.has(pattern.id)) throw usageError(`${where}.id "${pattern.id}" is not unique`);
    ids.add(pattern.id);
    const label = `${where} (${pattern.id})`;
    if (typeof pattern.why !== 'string' || pattern.why.trim() === '') {
        throw usageError(`${label}.why must be a non-empty string — a rule with no reason is not accepted`);
    }
    const base = {
        id: pattern.id,
        kind: pattern.kind,
        why: pattern.why,
        include: pattern.include === undefined ? null : stringArray(pattern.include, `${label}.include`),
        exclude: pattern.exclude === undefined ? [] : stringArray(pattern.exclude, `${label}.exclude`),
    };

    if (pattern.kind === 'regex') {
        for (const name of ['rule', 'ruleFile', 'language']) {
            if (name in pattern) throw usageError(`${label}.${name} applies only to kind "ast-grep"`);
        }
        nonEmptyString(pattern.regex, `${label}.regex`);
        try {
            new RegExp(pattern.regex, 'g');
        } catch (error) {
            throw usageError(`${label}.regex does not compile: ${error.message}`);
        }
        return { ...base, regex: pattern.regex };
    }

    if (pattern.kind === 'ast-grep') {
        if ('regex' in pattern) throw usageError(`${label}.regex applies only to kind "regex"`);
        if (('rule' in pattern) === ('ruleFile' in pattern)) {
            throw usageError(`${label} must set exactly one of rule / ruleFile`);
        }
        if (pattern.language !== undefined && !(pattern.language in AST_GREP_LANGUAGES)) {
            throw usageError(`${label}.language must be one of ${Object.keys(AST_GREP_LANGUAGES).join(', ')}`);
        }
        const ruleWhere = 'rule' in pattern ? `${label}.rule` : `${label}.ruleFile ${pattern.ruleFile}`;
        const ruleObject =
            'rule' in pattern
                ? pattern.rule
                : readJson(readFile, nonEmptyString(pattern.ruleFile, `${label}.ruleFile`), `${label}.ruleFile`);
        expectObject(ruleObject, ruleWhere);
        onlyKeys(ruleObject, ['rule', 'constraints', 'utils'], ruleWhere);
        required(ruleObject, ['rule'], ruleWhere);
        expectObject(ruleObject.rule, `${ruleWhere}.rule`);
        if (ruleObject.constraints !== undefined) expectObject(ruleObject.constraints, `${ruleWhere}.constraints`);
        if (ruleObject.utils !== undefined) expectObject(ruleObject.utils, `${ruleWhere}.utils`);
        return { ...base, language: pattern.language ?? null, rule: ruleObject };
    }

    if (pattern.kind === undefined) throw usageError(`${label}.kind is required (regex | ast-grep)`);
    throw usageError(`${label}.kind must be "regex" or "ast-grep", not ${JSON.stringify(pattern.kind)}`);
}

// Compile every ast-grep rule once, against an empty document. napi throws on an unknown kind, an unknown rule key
// or a malformed pattern; without an explicit `language` the rule must compile for every language it may meet.
function compileAstGrepRules(patterns) {
    const astGrep = patterns.filter((p) => p.kind === 'ast-grep');
    if (astGrep.length === 0) return;
    const napi = requireFromToolkit('@ast-grep/napi');
    for (const pattern of astGrep) {
        const languages = pattern.language ? [pattern.language] : Object.keys(AST_GREP_LANGUAGES);
        for (const language of languages) {
            try {
                napi.parse(napi.Lang[AST_GREP_LANGUAGES[language]], '').root().findAll(pattern.rule);
            } catch (error) {
                const hint = pattern.language ? '' : ' (no language set, so it must compile for javascript, typescript and tsx)';
                throw usageError(`ast-grep rule ${pattern.id} does not compile for ${language}${hint}: ${error.message}`);
            }
        }
    }
}

function loadConfig(configPath, { root = process.cwd(), readFile = defaultReader(root) } = {}) {
    return withSource(`config ${configPath}`, () => {
        const raw = expectObject(readJson(readFile, configPath, 'config'), 'config');
        onlyKeys(raw, ['scope', 'limits', 'patterns', 'baseline', 'receipts', 'verify', 'codemods'], '');
        required(raw, ['scope', 'limits', 'baseline', 'receipts'], '');

        expectObject(raw.scope, 'scope');
        onlyKeys(raw.scope, ['include', 'exclude'], 'scope');
        required(raw.scope, ['include', 'exclude'], 'scope');
        const scope = {
            include: stringArray(raw.scope.include, 'scope.include', { nonEmpty: true }),
            exclude: stringArray(raw.scope.exclude, 'scope.exclude'),
        };

        expectObject(raw.limits, 'limits');
        onlyKeys(raw.limits, ['fileLines', 'functionLines'], 'limits');
        required(raw.limits, ['fileLines', 'functionLines'], 'limits');
        const limits = {
            fileLines: positiveInteger(raw.limits.fileLines, 'limits.fileLines'),
            functionLines: positiveInteger(raw.limits.functionLines, 'limits.functionLines'),
        };

        const rawPatterns = raw.patterns ?? [];
        if (!Array.isArray(rawPatterns)) throw usageError('patterns must be an array');
        const ids = new Set();
        const patterns = rawPatterns.map((pattern, index) => validatePattern(pattern, index, ids, readFile));

        let commands = [];
        if (raw.verify !== undefined) {
            expectObject(raw.verify, 'verify');
            onlyKeys(raw.verify, ['commands'], 'verify');
            if (raw.verify.commands !== undefined) {
                if (!Array.isArray(raw.verify.commands)) throw usageError('verify.commands must be an array');
                commands = raw.verify.commands.map((command, index) => {
                    const where = `verify.commands[${index}]`;
                    expectObject(command, where);
                    onlyKeys(command, ['name', 'argv'], where);
                    required(command, ['name', 'argv'], where);
                    return { name: nonEmptyString(command.name, `${where}.name`), argv: stringArray(command.argv, `${where}.argv`, { nonEmpty: true }) };
                });
            }
        }

        const config = {
            scope,
            limits,
            patterns,
            baseline: nonEmptyString(raw.baseline, 'baseline'),
            receipts: nonEmptyString(raw.receipts, 'receipts'),
            verify: { commands },
            // Directory globs naming the codemod catalog (core/codemodCatalog.js); a match holding codemod.json is an entry.
            codemods: raw.codemods === undefined ? [] : stringArray(raw.codemods, 'codemods'),
        };
        compileAstGrepRules(patterns); // after every shape check: a usage error outranks a missing dependency
        return config;
    });
}

// ── Recipe ──────────────────────────────────────────────────────────────────────────────────────────────────

function loadRecipe(recipePath, { root = process.cwd(), readFile = defaultReader(root) } = {}) {
    return withSource(`recipe ${recipePath}`, () => {
        const raw = expectObject(readJson(readFile, recipePath, 'recipe'), 'recipe');
        onlyKeys(raw, ['$schema', 'name', 'strategy', 'source', 'host', 'targetDirectory', 'parts', 'keep', 'raises', 'accept', 'verify'], '');
        required(raw, ['$schema', 'name', 'strategy', 'source', 'targetDirectory', 'parts'], '');
        if (raw.$schema !== 'refactor-engine/recipe/1') throw usageError('$schema must be "refactor-engine/recipe/1"');
        if (typeof raw.name !== 'string' || !KEBAB.test(raw.name)) throw usageError('name must be kebab-case');
        if (!STRATEGIES.includes(raw.strategy)) throw usageError(`strategy must be one of ${STRATEGIES.join(', ')}`);
        const splitClass = raw.strategy === 'split-class';
        nonEmptyString(raw.source, 'source');
        nonEmptyString(raw.targetDirectory, 'targetDirectory');
        if (splitClass) {
            if (typeof raw.host !== 'string' || !IDENTIFIER.test(raw.host)) throw usageError('host must be a class name (required for split-class)');
        } else if ('host' in raw) {
            throw usageError('host applies only to split-class');
        }

        if (!Array.isArray(raw.parts) || raw.parts.length === 0) throw usageError('parts must be a non-empty array');
        const partNames = new Set();
        const assigned = new Map(); // member or declaration -> part
        const parts = raw.parts.map((part, index) => {
            const where = `parts[${index}]`;
            expectObject(part, where);
            onlyKeys(part, ['name', 'directory', 'members', 'declarations'], where);
            if (typeof part.name !== 'string' || !IDENTIFIER.test(part.name)) throw usageError(`${where}.name must be an identifier`);
            if (partNames.has(part.name)) throw usageError(`${where}.name "${part.name}" is not unique`);
            partNames.add(part.name);
            const label = `${where} (${part.name})`;
            if (part.directory !== undefined) nonEmptyString(part.directory, `${label}.directory`);
            let members = [];
            if (splitClass) {
                if (!('members' in part)) throw usageError(`missing required key ${label}.members`);
                members = stringArray(part.members, `${label}.members`);
                if (members.includes('constructor')) throw usageError(`${label}.members: the constructor stays in the facade`);
            } else if ('members' in part) {
                throw usageError(`${label}.members applies only to split-class; use declarations`);
            }
            const declarations = part.declarations === undefined ? [] : stringArray(part.declarations, `${label}.declarations`);
            if (!splitClass && declarations.length === 0) throw usageError(`${label}.declarations must not be empty`);
            if (members.length + declarations.length === 0) throw usageError(`${label} moves nothing`);
            for (const name of [...members, ...declarations]) {
                if (assigned.has(name)) throw usageError(`"${name}" is assigned to both ${assigned.get(name)} and ${part.name}`);
                assigned.set(name, part.name);
            }
            return { name: part.name, directory: part.directory ?? null, members, declarations };
        });

        const keep = raw.keep === undefined ? [] : stringArray(raw.keep, 'keep');
        for (const name of keep) {
            if (assigned.has(name)) throw usageError(`keep lists "${name}", which ${assigned.get(name)} moves`);
        }

        for (const name of ['raises', 'accept']) {
            if (raw[name] !== undefined && !Array.isArray(raw[name])) throw usageError(`${name} must be an array`);
        }
        const raises = (raw.raises ?? []).map((raise, index) => {
            const where = `raises[${index}]`;
            expectObject(raise, where);
            onlyKeys(raise, ['part', 'reason'], where);
            required(raise, ['part', 'reason'], where);
            if (!partNames.has(raise.part)) throw usageError(`${where}.part "${raise.part}" is not a part of this recipe`);
            return { part: raise.part, reason: nonEmptyString(raise.reason, `${where}.reason`) };
        });

        const accept = (raw.accept ?? []).map((entry, index) => {
            const where = `accept[${index}]`;
            expectObject(entry, where);
            onlyKeys(entry, ['code', 'member', 'reason'], where);
            required(entry, ['code', 'member', 'reason'], where);
            if (!ACCEPTABLE_CODES.includes(entry.code)) throw usageError(`${where}.code must be one of ${ACCEPTABLE_CODES.join(', ')}`);
            return { code: entry.code, member: nonEmptyString(entry.member, `${where}.member`), reason: nonEmptyString(entry.reason, `${where}.reason`) };
        });

        let loadModule = false;
        if (raw.verify !== undefined) {
            expectObject(raw.verify, 'verify');
            onlyKeys(raw.verify, ['loadModule'], 'verify');
            if (raw.verify.loadModule !== undefined && typeof raw.verify.loadModule !== 'boolean') throw usageError('verify.loadModule must be a boolean');
            loadModule = raw.verify.loadModule ?? false;
        }

        return {
            path: recipePath,
            name: raw.name,
            strategy: raw.strategy,
            source: raw.source,
            host: splitClass ? raw.host : null,
            targetDirectory: raw.targetDirectory,
            parts,
            keep,
            raises,
            accept,
            verify: { loadModule },
        };
    });
}

// ── Baseline ────────────────────────────────────────────────────────────────────────────────────────────────

const BASELINE_SCHEMA = 'refactor-engine/baseline/1';

function loadBaseline(baselinePath, { root = process.cwd(), readFile = defaultReader(root) } = {}) {
    return withSource(`baseline ${baselinePath}`, () => {
        const text = readFile(baselinePath);
        if (text === null) return { $schema: BASELINE_SCHEMA, limits: null, files: {}, exists: false };
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (error) {
            throw usageError(`not valid JSON: ${error.message}`);
        }
        expectObject(raw, 'baseline');
        onlyKeys(raw, ['$schema', 'limits', 'files'], '');
        required(raw, ['$schema', 'files'], '');
        if (raw.$schema !== BASELINE_SCHEMA) throw usageError(`$schema must be "${BASELINE_SCHEMA}"`);
        let limits = null;
        if (raw.limits !== undefined) {
            expectObject(raw.limits, 'limits');
            onlyKeys(raw.limits, ['fileLines', 'functionLines'], 'limits');
            limits = { fileLines: positiveInteger(raw.limits.fileLines, 'limits.fileLines'), functionLines: positiveInteger(raw.limits.functionLines, 'limits.functionLines') };
        }
        expectObject(raw.files, 'files');
        const files = {};
        for (const [file, entry] of Object.entries(raw.files)) {
            const where = `files["${file}"]`;
            expectObject(entry, where);
            onlyKeys(entry, ['lines', 'maxFunction', 'patterns', 'reason'], where);
            required(entry, ['lines', 'reason'], where);
            if (!Number.isInteger(entry.lines) || entry.lines < 0) throw usageError(`${where}.lines must be a non-negative integer`);
            let maxFunction = null;
            if (entry.maxFunction !== undefined && entry.maxFunction !== null) {
                expectObject(entry.maxFunction, `${where}.maxFunction`);
                onlyKeys(entry.maxFunction, ['lines', 'name', 'line'], `${where}.maxFunction`);
                required(entry.maxFunction, ['lines', 'name', 'line'], `${where}.maxFunction`);
                maxFunction = { lines: positiveInteger(entry.maxFunction.lines, `${where}.maxFunction.lines`), name: String(entry.maxFunction.name), line: positiveInteger(entry.maxFunction.line, `${where}.maxFunction.line`) };
            }
            const patterns = {};
            if (entry.patterns !== undefined) {
                expectObject(entry.patterns, `${where}.patterns`);
                for (const [id, count] of Object.entries(entry.patterns)) {
                    if (!Number.isInteger(count) || count < 0) throw usageError(`${where}.patterns.${id} must be a non-negative integer`);
                    patterns[id] = count;
                }
            }
            files[file] = { lines: entry.lines, maxFunction, patterns, reason: nonEmptyString(entry.reason, `${where}.reason`) };
        }
        return { $schema: BASELINE_SCHEMA, limits, files, exists: true };
    });
}

module.exports = {
    loadConfig, loadRecipe, loadBaseline, defaultReader, AST_GREP_LANGUAGES, BASELINE_SCHEMA,
    // validation helpers shared with the codemod recipe loader (core/codemod.js)
    KEBAB, readJson, expectObject, onlyKeys, required, nonEmptyString, stringArray, positiveInteger, withSource,
};
