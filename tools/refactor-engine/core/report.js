'use strict';

// Human and markdown renderings of a MovePlan (contracts/cli.md `plan`) and the inventory table.

const number = (n) => n.toLocaleString('en-US');
const pad = (text, width) => String(text).padEnd(width);
const rpad = (text, width) => String(text).padStart(width);

function planLines(plan) {
    if (plan.nothingToMove) return [`plan: ${plan.recipe} — nothing to move (every move in ${plan.receipt} is in place)`];
    const lines = [`plan: ${plan.recipe} (${plan.strategy}${plan.host ? `, host ${plan.host}` : ''})`, `source ${plan.source.path}  ${number(plan.source.lines)} lines  ${plan.source.hash}`, ''];
    const width = Math.max(11, ...plan.rows.map((r) => r.destination.length)) + 2;
    lines.push(`${pad('destination', width)}${rpad('moved', 8)}${rpad('lines', 7)}  over  notes`);
    for (const row of plan.rows) {
        const notes = [];
        if (row.hostBinding) notes.push('requires host (R3)');
        if (row.declarations && row.declarations.length > 0) notes.push(`declarations: ${row.declarations.join(', ')}`);
        if (row.hoisted && row.hoisted.length > 0) notes.push(`hoisted: ${row.hoisted.join(', ')}`);
        if (row.shared && row.shared.length > 0) notes.push(`from shared: ${row.shared.join(', ')}`);
        if (row.exports && row.exports.length > 0) notes.push(`exports: ${row.exports.join(', ')}`);
        if (row.imports.length > 0) notes.push(`imports: ${row.imports.join('; ')}`);
        lines.push(`${pad(row.destination, width)}${rpad(row.members.length + (row.declarations || []).length, 8)}${rpad(number(row.lines), 7)}  ${pad(row.overLimit ? 'yes' : 'no', 4)}  ${notes.join(' · ')}`);
    }
    lines.push('');
    if (plan.refusals.length === 0) lines.push('refusals: none');
    else {
        lines.push(`refusals (${plan.refusals.length}):`);
        for (const r of plan.refusals) lines.push(`  ${r.code}  ${r.name}${r.line ? `:${r.line}` : ''}  ${r.message}`, `          → ${r.wayForward}`);
    }
    const refs = plan.pathReferences;
    if (refs.length === 0) lines.push('path references to reconcile: none');
    else {
        const actionable = refs.filter((r) => r.action !== 'none').length;
        lines.push(`path references (${refs.length}, ${actionable} to reconcile):`);
        for (const r of refs) lines.push(`  ${pad(r.kind, 9)} ${pad(`${r.file}:${r.line}`, 60)} ${pad(r.form, 9)} ${r.action === 'none' ? ((r.kind === 'code' || r.kind === 'test') && /require|import/.test(r.text) ? '(requires the facade; no action)' : '(rewritten by apply or names its own source; no action)') : `"${r.text.slice(0, 70)}"`}`);
    }
    const effect = plan.ratchetEffect;
    if (!effect || !effect.inScope) lines.push('ratchet: source is out of scope; baseline untouched');
    else {
        const parts = [];
        for (const e of effect.removed) parts.push(`remove ${e.path} (${number(e.lines)})`);
        for (const e of effect.updated) parts.push(`update ${e.path} ${e.was === null ? '' : `${number(e.was)} → `}${number(e.lines)}`);
        if (effect.added.length > 0) parts.push(`add ${effect.added.length} ${effect.added.length === 1 ? 'entry' : 'entries'} (${effect.added.map((e) => `${e.path} ${number(e.lines)}${e.raised ? ', raised' : ''}`).join('; ')})`);
        lines.push(`ratchet: ${parts.length > 0 ? parts.join('; ') : 'no baseline change'}; raises needed: ${effect.raisesNeeded.length}`);
    }
    lines.push(`summary: ${number(plan.summary.originalLines)} lines → facade ${number(plan.summary.facadeLines)} + parts ${number(plan.summary.partLines)} (${plan.summary.addedLines >= 0 ? '+' : ''}${number(plan.summary.addedLines)})`);
    return lines;
}

function planMarkdown(plan) {
    if (plan.nothingToMove) return [`**plan ${plan.recipe}**: nothing to move.`];
    const lines = [`### plan: ${plan.recipe} (${plan.strategy}${plan.host ? `, host \`${plan.host}\`` : ''})`, '', `source \`${plan.source.path}\`, ${number(plan.source.lines)} lines, \`${plan.source.hash}\``, '', '| destination | members | lines | over | notes |', '|---|---:|---:|---|---|'];
    for (const row of plan.rows) {
        const notes = [];
        if (row.hostBinding) notes.push('requires host');
        if (row.declarations && row.declarations.length > 0) notes.push(`declarations: ${row.declarations.join(', ')}`);
        if (row.shared && row.shared.length > 0) notes.push(`from shared: ${row.shared.join(', ')}`);
        lines.push(`| \`${row.destination}\` | ${row.members.length}${row.members.length > 0 ? ` (${row.members.join(', ')})` : ''} | ${number(row.lines)} | ${row.overLimit ? 'yes' : 'no'} | ${notes.join('; ')} |`);
    }
    lines.push('');
    lines.push(plan.refusals.length === 0 ? '**refusals**: none' : `**refusals** (${plan.refusals.length}):`);
    for (const r of plan.refusals) lines.push(`- \`${r.code}\` ${r.name}${r.line ? `:${r.line}` : ''} — ${r.message}. ${r.wayForward}`);
    lines.push('');
    if (plan.pathReferences.length === 0) lines.push('**path references**: none');
    else {
        lines.push(`**path references** (${plan.pathReferences.length}):`, '', '| kind | file | form | action |', '|---|---|---|---|');
        for (const r of plan.pathReferences) lines.push(`| ${r.kind} | \`${r.file}:${r.line}\` | ${r.form} | ${r.action} |`);
    }
    lines.push('', `**summary**: ${number(plan.summary.originalLines)} lines → facade ${number(plan.summary.facadeLines)} + parts ${number(plan.summary.partLines)} (${plan.summary.addedLines >= 0 ? '+' : ''}${number(plan.summary.addedLines)})`);
    return lines;
}

function inventoryLines(json) {
    const lines = [`inventory: ${json.file} (${json.language}, ${number(json.lines)} lines, export ${json.exportShape}${json.exportedClass ? ` ${json.exportedClass}` : ''})`];
    for (const cls of json.classes) {
        lines.push('', `class ${cls.name}${cls.base ? ` extends ${cls.base}` : ''}${cls.exported ? ' (exported)' : ''}: ${cls.members.length} members`);
        const width = Math.max(6, ...cls.members.map((m) => m.name.length)) + 2;
        lines.push(`${pad('member', width)}${pad('kind', 12)}${pad('static', 7)}${rpad('lines', 6)}${rpad('at', 7)}  host  flags`);
        for (const m of cls.members) {
            const flags = [];
            if (m.locationSensitive.length > 0) flags.push('location-sensitive');
            if (m.dynamic.length > 0) flags.push('dynamic-require');
            if (m.computedThis.length > 0) flags.push('computed-this');
            if (m.privateNames.length > 0 || m.private) flags.push('private-name');
            if (m.topLevelRefs.length > 0) flags.push(`uses ${m.topLevelRefs.join(', ')}`);
            lines.push(`${pad(m.name, width)}${pad(m.kind, 12)}${pad(m.static ? 'yes' : '', 7)}${rpad(number(m.lines), 6)}${rpad(m.span.startLine, 7)}  ${pad(m.hostRefs ? 'yes' : '', 4)}  ${flags.join(', ')}`);
        }
        if (cls.postStatements.length > 0) lines.push(`post-class statements referencing ${cls.name}: lines ${cls.postStatements.join(', ')}`);
    }
    const decls = json.declarations.filter((d) => d.names.length > 0);
    if (decls.length > 0) {
        lines.push('', 'top-level declarations:');
        for (const d of decls) {
            const flags = [];
            if (d.reassigned) flags.push('reassigned');
            if (d.sideEffect) flags.push('side-effect');
            if (d.locationSensitive.length > 0) flags.push('location-sensitive');
            lines.push(`  ${pad(d.kind, 9)} ${pad(d.names.join(', '), 40)} ${rpad(number(d.lines), 5)} lines  at ${d.span.startLine}${flags.length > 0 ? `  ${flags.join(', ')}` : ''}`);
        }
    }
    if (json.affinity && json.affinity.length > 0) {
        lines.push('', 'advisory clusters (members sharing this-calls or this-fields; never read by plan or apply):');
        for (const cluster of json.affinity) lines.push(`  [${cluster.members.length}] ${cluster.members.join(', ')}${cluster.sharedFields.length > 0 ? `  — fields: ${cluster.sharedFields.join(', ')}` : ''}`);
        const hubFields = json.affinity[0].hubFields || [];
        if (hubFields.length > 0) lines.push(`  (fields used by more than half of the members, not joined on: ${hubFields.join(', ')})`);
    }
    return lines;
}

function codemodFixtureLines(results) {
    return results.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.codemod}/${r.fixture} (${r.kind})${r.ok ? '' : `\n     ${r.failure.split('\n').join('\n     ')}`}`);
}

// The dry run's patch goes to stderr with the rest of the human text, unless --patch captured it in a file.
function codemodRunLines(codemod, result, { write: writeRequested, patchFile, json }) {
    const lines = [...codemodFixtureLines(result.fixtures)];
    // A failed postcondition turns --write back into a dry run; say what happened, not what was asked.
    const write = writeRequested && !result.postconditions.some((p) => p.hits.length > 0);
    if (result.fixtures.some((f) => !f.ok)) return [...lines, `codemod ${codemod.id}: fixtures failed — nothing was run`];
    if (!json && patchFile === null && result.patch !== '') lines.push(result.patch.trimEnd());
    for (const f of result.files) {
        if (f.status === 'refused') lines.push(`REFUSED ${f.path}  ${f.refusal.code}: ${f.refusal.message}`);
        else lines.push(`${write ? 'wrote' : 'would change'} ${f.path}  (passes ${f.passes}${f.ratchet ? `, ${codemod.ratchet} ${f.ratchet.before} → ${f.ratchet.after}` : ''})`);
    }
    const changed = result.files.filter((f) => f.status === 'changed').length;
    const refused = result.files.length - changed;
    const ratchet = result.ratchet ? `, ${result.ratchet.id} ${result.ratchet.before} → ${result.ratchet.after} in changed files` : '';
    lines.push(`codemod ${codemod.id}: ${changed} ${write ? 'written' : 'would change (dry run)'}, ${refused} refused${ratchet}${patchFile ? `, patch in ${patchFile}` : ''}`);
    if (result.ratchetFindings.length > 0) {
        const { formatFinding } = require('./ratchet');
        lines.push(`ratchet: the ${write ? 'written' : 'rewritten'} files would fail audit with ${result.ratchetFindings.length} finding(s); split, or raise each with a reason:`);
        lines.push(...result.ratchetFindings.map(formatFinding));
    }
    for (const pc of result.postconditions.filter((p) => p.hits.length > 0)) {
        lines.push(`POSTCONDITION absent /${pc.absent}/: ${pc.hits.length} residual(s) — ${pc.why}`);
        lines.push(...pc.hits.slice(0, 20).map((h) => `  ${h.path}:${h.line}  ${h.text}`));
        if (pc.hits.length > 20) lines.push(`  … ${pc.hits.length - 20} more (--json lists every hit)`);
    }
    if (writeRequested && !write) lines.push(`codemod ${codemod.id}: postconditions failed — nothing was written`);
    for (const note of codemod.review) lines.push(`  review: ${note}`);
    return lines;
}

function codemodListLines(rows, invalid) {
    const lines = [];
    for (const r of rows) {
        const reach = r.ratchet === null ? 'no ratchet' : `ratchet ${r.ratchet}: ${number(r.ratchetMatches)} match(es) in the files it selects`;
        lines.push(`${r.id}  ${r.dir}`, `    why: ${r.why}`, `    ${reach} · ${r.fixtures} fixture(s) · ${r.postconditions} postcondition(s)`);
    }
    for (const i of invalid) lines.push(`INVALID ${i.dir}  ${i.error}`);
    lines.push(`codemod list: ${rows.length} codemod(s), ${invalid.length} invalid`);
    return lines;
}

function codemodNewLines(created) {
    return [
        ...created.files.map((f) => `created ${f}`),
        `next: write "why" in ${created.dir}/codemod.json (the codemod does not load without it), replace the example pattern and fixtures, then: refactor-engine codemod test ${created.dir}`,
        ...(created.inCatalog ? [] : [`note: ${created.dir} is not matched by the host config's "codemods" globs, so codemod list and audit fix hints will not see it`]),
    ];
}

module.exports = { planLines, planMarkdown, inventoryLines, codemodFixtureLines, codemodRunLines, codemodListLines, codemodNewLines };
