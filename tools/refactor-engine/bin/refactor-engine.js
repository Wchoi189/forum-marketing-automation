#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EXIT, ToolkitError } = require('../core/errors');

const DEFAULT_CONFIG = 'docs/architecture/refactor-engine.config.json';

// Per command: options (flag -> { key, takesValue }) and how many positionals it takes.
const COMMANDS = {
    inventory: { options: {}, positionals: { min: 1, max: 1, name: '<file>' } },
    plan: { options: { '--markdown': { key: 'markdown', takesValue: false } }, positionals: { min: 1, max: 1, name: '<recipe>' } },
    apply: { options: { '--plan': { key: 'plan', takesValue: true } }, positionals: { min: 1, max: 1, name: '<recipe>' } },
    verify: { options: { '--drift-only': { key: 'driftOnly', takesValue: false } }, positionals: { min: 1, max: 1, name: '<recipe>' } },
    audit: {
        options: { '--staged': { key: 'staged', takesValue: false }, '--since': { key: 'since', takesValue: true } },
        positionals: { min: 0, max: Infinity, name: '[paths…]' },
    },
    baseline: {
        options: {
            '--write': { key: 'write', takesValue: false },
            '--init': { key: 'init', takesValue: false },
            '--raise': { key: 'raise', takesValue: true },
            '--reason': { key: 'reason', takesValue: true },
        },
        positionals: { min: 0, max: 0, name: '' },
    },
    codemod: {
        options: {
            '--write': { key: 'write', takesValue: false },
            '--check': { key: 'check', takesValue: false },
            '--staged': { key: 'staged', takesValue: false },
            '--patch': { key: 'patch', takesValue: true },
            '--receipt': { key: 'receipt', takesValue: true },
            '--ratchet': { key: 'ratchet', takesValue: true },
        },
        positionals: { min: 1, max: Infinity, name: 'run|test|list|new' },
    },
};
const TAKES_VALUE = {};
for (const { options } of Object.values(COMMANDS)) {
    for (const [flag, spec] of Object.entries(options)) TAKES_VALUE[flag] = spec.takesValue;
}

const USAGE = `usage: refactor-engine <command> [options]

commands:
  inventory <file>
  plan      <recipe> [--markdown]
  apply     <recipe> [--plan <plan.json>]
  verify    <recipe> [--drift-only]
  audit     [--staged | --since <ref>] [paths…]
  baseline  --init | --write | --raise <path> --reason <text>
  codemod   run <codemod-dir> [paths…] [--staged] [--write [--receipt <file>]] [--check] [--patch <file>]
  codemod   test [<codemod-dir>…]        (no directory: every catalog entry)
  codemod   list
  codemod   new <codemod-dir> [--ratchet <pattern-id>]

global options:
  -c, --config <path>   host config, relative to the root (default ${DEFAULT_CONFIG})
  --root <dir>          repository root (default: nearest directory holding .git, else the current directory)
  --json                one result object on stdout, human text on stderr
  -h, --help            this text`;

function usageError(message) {
    return new ToolkitError(`${message}\n\n${USAGE}`, EXIT.USAGE);
}

function parseArgs(argv) {
    const parsed = { config: DEFAULT_CONFIG, root: null, json: false, help: false, command: null, options: {}, positionals: [] };
    const seen = [];
    for (let i = 0; i < argv.length; i += 1) {
        let arg = argv[i];
        let inline;
        if (arg.startsWith('--') && arg.includes('=')) {
            inline = arg.slice(arg.indexOf('=') + 1);
            arg = arg.slice(0, arg.indexOf('='));
        }
        const value = () => {
            if (inline !== undefined) return inline;
            const next = argv[i + 1];
            if (next === undefined || (next.startsWith('-') && next !== '-')) throw usageError(`option ${arg} requires a value`);
            i += 1;
            return next;
        };
        const noValue = () => {
            if (inline !== undefined) throw usageError(`option ${arg} takes no value`);
        };

        if (arg === '-c' || arg === '--config') parsed.config = value();
        else if (arg === '--root') parsed.root = value();
        else if (arg === '--json') {
            noValue();
            parsed.json = true;
        } else if (arg === '-h' || arg === '--help') {
            noValue();
            parsed.help = true;
        } else if (arg in TAKES_VALUE) {
            if (TAKES_VALUE[arg]) seen.push([arg, value()]);
            else {
                noValue();
                seen.push([arg, true]);
            }
        } else if (arg.startsWith('-')) throw usageError(`unknown option ${arg}`);
        else if (parsed.command === null) parsed.command = arg;
        else parsed.positionals.push(arg);
    }

    if (parsed.help) return parsed;
    if (parsed.command === null) throw usageError('no command given');
    const spec = COMMANDS[parsed.command];
    if (!spec) throw usageError(`unknown command ${parsed.command}`);
    for (const [arg, optionValue] of seen) {
        if (!(arg in spec.options)) throw usageError(`option ${arg} does not apply to ${parsed.command}`);
        parsed.options[spec.options[arg].key] = optionValue;
    }
    const { min, max, name } = spec.positionals;
    if (parsed.positionals.length < min) throw usageError(`${parsed.command} requires ${name}`);
    if (parsed.positionals.length > max) throw usageError(`unexpected argument ${parsed.positionals[max]}`);

    const o = parsed.options;
    if (parsed.command === 'audit' && o.staged && o.since !== undefined) throw usageError('audit takes --staged or --since, not both');
    if (parsed.command === 'baseline') {
        const modes = ['init', 'write', 'raise'].filter((mode) => o[mode] !== undefined);
        if (modes.length !== 1) throw usageError('baseline takes exactly one of --init, --write, --raise <path>');
        if (o.raise !== undefined && (o.reason === undefined || o.reason.trim() === '')) throw usageError('baseline --raise requires a non-empty --reason');
        if (o.raise === undefined && o.reason !== undefined) throw usageError('--reason applies only to baseline --raise');
    }
    if (parsed.command === 'codemod') {
        const [sub, ...dirs] = parsed.positionals;
        if (!['run', 'test', 'list', 'new'].includes(sub)) throw usageError(`codemod takes run, test, list or new, not ${sub}`);
        if (sub !== 'run' && sub !== 'new' && Object.keys(o).length > 0) throw usageError(`codemod ${sub} takes no options`);
        if (o.ratchet !== undefined && sub !== 'new') throw usageError('--ratchet applies only to codemod new');
        if (sub === 'new' && Object.keys(o).some((k) => k !== 'ratchet')) throw usageError('codemod new takes only --ratchet');
        if (sub === 'run' && dirs.length === 0) throw usageError('codemod run requires <codemod-dir>');
        if (sub === 'new' && dirs.length !== 1) throw usageError('codemod new requires exactly one <codemod-dir>');
        if (sub === 'list' && dirs.length > 0) throw usageError(`unexpected argument ${dirs[0]}`);
        if (sub === 'run' && parsed.positionals.length > 2 && o.staged) throw usageError('codemod run takes --staged or paths, not both');
        if (o.receipt !== undefined && !o.write) throw usageError('--receipt applies only with --write');
        if (o.check && o.write) throw usageError('codemod run takes --check or --write, not both');
    }
    return parsed;
}

function resolveRoot(parsed) {
    const { findRoot } = require('../core/repo');
    if (parsed.root === null) return findRoot(process.cwd());
    const root = path.resolve(parsed.root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw usageError(`--root "${parsed.root}" is not a directory`);
    return root;
}

// Lazy requires: nothing under core/ that needs a dependency loads before argv is parsed, so a usage error is
// reported as 4 even where the toolkit was never installed. Dependencies are checked before any config is read.
function prepare(parsed) {
    const { requireFromToolkit } = require('../core/deps');
    requireFromToolkit('typescript');
    return { root: resolveRoot(parsed) };
}


function planFor(parsed, context, { withPathReferences = true } = {}) {
    const recipe = require('../core/config').loadRecipe(parsed.positionals[0], { root: context.root });
    const { buildPlan } = require('../core/planner');
    const plan = buildPlan({ root: context.root, config: context.config, baseline: context.baseline, recipe, withPathReferences });
    return { recipe, plan };
}

// The --json object for plan/apply: the plan without its in-memory file contents.
function planJson(command, plan) {
    const { files, sourceText, moves, generated, ...rest } = plan;
    return { command, ...rest, ratchetEffect: plan.ratchetEffect ? { ...plan.ratchetEffect, files: undefined } : null };
}

function readSavedPlan(root, relPath) {
    const full = path.resolve(root, relPath);
    if (!fs.existsSync(full)) throw new ToolkitError(`--plan ${relPath} does not exist`, EXIT.USAGE);
    let saved;
    try {
        saved = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
        throw new ToolkitError(`--plan ${relPath} is not valid JSON: ${error.message}`, EXIT.USAGE);
    }
    if (!saved || !saved.source || typeof saved.source.hash !== 'string') throw new ToolkitError(`--plan ${relPath} is not a plan --json result`, EXIT.USAGE);
    return saved;
}


// Under `audit --staged` the config and the baseline are read from the git index like every file it measures:
// a commit that raises a baseline entry and grows the file is judged against the baseline it stages.
function withConfig(parsed, { staged = false } = {}) {
    const context = prepare(parsed);
    const { loadConfig, loadBaseline, defaultReader } = require('../core/config');
    const readFile = staged ? (relPath) => require('../core/repo').readIndex(context.root, relPath) : defaultReader(context.root);
    context.config = loadConfig(parsed.config, { root: context.root, readFile });
    context.baseline = loadBaseline(context.config.baseline, { root: context.root, readFile });
    return context;
}

function report(parsed, lines, result) {
    if (lines.length > 0) process.stderr.write(`${lines.join('\n')}\n`);
    if (parsed.json) process.stdout.write(`${JSON.stringify(result)}\n`);
}

const HANDLERS = {
    inventory(parsed) {
        const { root } = prepare(parsed);
        const { normalizePath, worktreeReader } = require('../core/audit');
        const relPath = normalizePath(root, parsed.positionals[0]);
        const text = worktreeReader(root)(relPath);
        if (text === null) throw new ToolkitError(`inventory: ${relPath} does not exist`, EXIT.USAGE);
        const { inventoryFile, toJson } = require('../core/inventory');
        const { clusters } = require('../core/affinity');
        const { inventoryLines } = require('../core/report');
        const { inventory } = inventoryFile(root, relPath, text);
        const host = inventory.classes.find((c) => c.exported) || inventory.classes[0] || null;
        const json = toJson(inventory, host ? clusters(host.members) : []);
        report(parsed, inventoryLines(json), json);
        return EXIT.OK;
    },
    plan(parsed) {
        const context = withConfig(parsed);
        const { plan } = planFor(parsed, context);
        const { planLines, planMarkdown } = require('../core/report');
        report(parsed, parsed.options.markdown ? planMarkdown(plan) : planLines(plan), planJson('plan', plan));
        return plan.refusals.length > 0 ? EXIT.FINDING : EXIT.OK;
    },
    apply(parsed) {
        const context = withConfig(parsed);
        const { recipe, plan } = planFor(parsed, context, { withPathReferences: false });
        const { planLines } = require('../core/report');
        if (plan.nothingToMove) {
            report(parsed, planLines(plan), planJson('apply', plan));
            return EXIT.OK;
        }
        if (parsed.options.plan !== undefined) {
            const saved = readSavedPlan(context.root, parsed.options.plan);
            if (saved.source.hash !== plan.source.hash) {
                const { refusal } = require('../core/preconditions');
                plan.refusals.push(refusal('RF-SOURCE-CHANGED', plan.source.path, 0, `${plan.source.path} is ${plan.source.hash}; the plan was computed against ${saved.source.hash}`));
            }
        }
        if (plan.refusals.length > 0) {
            report(parsed, planLines(plan), planJson('apply', plan));
            return EXIT.FINDING;
        }
        const { applyPlan } = require('../core/apply');
        const { written } = applyPlan({ root: context.root, config: context.config, baseline: context.baseline, recipe, plan });
        report(parsed, [...planLines(plan), '', ...written.map((p) => `wrote ${p}`)], { ...planJson('apply', plan), written });
        return EXIT.OK;
    },
    verify(parsed) {
        const context = withConfig(parsed);
        const recipe = require('../core/config').loadRecipe(parsed.positionals[0], { root: context.root });
        const { verifyRecipe } = require('../core/verify');
        const result = verifyRecipe({ root: context.root, config: context.config, recipe, driftOnly: Boolean(parsed.options.driftOnly), json: parsed.json });
        const lines = result.findings.map((f) => `${f.check}  ${f.message}`);
        const failed = result.commands.find((c) => c.status !== 0) || null;
        for (const command of result.commands) lines.push(`command ${command.name}: ${command.status === 0 ? 'ok' : `exit ${command.status ?? command.error}`}`);
        let exitCode = EXIT.OK;
        if (result.findings.length > 0) exitCode = EXIT.FINDING;
        else if (failed) exitCode = EXIT.COMMAND_FAILED;
        lines.push(`verify: ${recipe.name} — ${result.findings.length} findings, ${result.commands.length} commands${parsed.options.driftOnly ? ' (drift only)' : ''}: ${exitCode === EXIT.OK ? 'ok' : exitCode === EXIT.FINDING ? 'FAILED' : `command "${failed.name}" failed`}`);
        report(parsed, lines, { command: 'verify', recipe: recipe.name, exitCode, findings: result.findings, commands: result.commands, capabilityBytes: result.capabilityBytes });
        return exitCode;
    },
    audit(parsed) {
        const staged = Boolean(parsed.options.staged);
        const { root, config, baseline } = withConfig(parsed, { staged });
        const { runAudit } = require('../core/audit');
        const { formatFinding, formatWarning } = require('../core/ratchet');
        const result = runAudit({ root, config, baseline, staged, since: parsed.options.since ?? null, paths: parsed.positionals });
        const lines = [
            ...result.findings.map(formatFinding),
            ...result.warnings.map(formatWarning),
            `audit: ${result.files} files, ${result.findings.length} findings, ${result.warnings.length} warnings (${result.elapsedMs} ms)`,
        ];
        report(parsed, lines, result);
        return result.findings.length > 0 ? EXIT.FINDING : EXIT.OK;
    },
    baseline(parsed) {
        const context = withConfig(parsed);
        const baseline = require('../core/baseline');
        const o = parsed.options;
        let outcome;
        if (o.init) outcome = baseline.init(context);
        else if (o.write) outcome = baseline.write(context);
        else outcome = baseline.raise({ ...context, target: o.raise, reason: o.reason });
        const mode = o.init ? 'init' : o.write ? 'write' : 'raise';
        const lines = [...outcome.warnings.map((w) => `WARN ${w}`), ...outcome.changes.map((c) => `baseline: ${c}`)];
        if (mode === 'write' && outcome.changes.length === 0) lines.push('baseline: nothing to lower');
        report(parsed, lines, { command: 'baseline', mode, changes: outcome.changes, warnings: outcome.warnings });
        return EXIT.OK;
    },
    codemod(parsed) {
        return require('./codemodCommand').codemodCommand(parsed, { prepare, withConfig, report });
    },
};

async function main(argv) {
    let parsed = { json: argv.includes('--json'), command: null };
    try {
        parsed = parseArgs(argv);
        if (parsed.help) {
            process.stderr.write(`${USAGE}\n`);
            return EXIT.OK;
        }
        return await HANDLERS[parsed.command](parsed);
    } catch (error) {
        const known = error instanceof ToolkitError;
        const exitCode = known ? error.exitCode : EXIT.USAGE;
        // An unexpected exception is a toolkit defect: print the stack and exit 4, never 0.
        process.stderr.write(`refactor-engine: ${known ? error.message : error.stack}\n`);
        if (parsed.json) {
            const firstLine = String(known ? error.message : error.message || error).split('\n')[0];
            process.stdout.write(`${JSON.stringify({ command: parsed.command, exitCode, error: firstLine })}\n`);
        }
        return exitCode;
    }
}

main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
