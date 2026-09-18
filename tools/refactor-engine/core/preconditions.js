'use strict';

// Refusals (data-model.md §4) for split-class: each names its code, the member or declaration, its line, a message
// and the way forward. Recipe-validity failures are usage errors (exit 4) and throw instead.

const { usageError } = require('./errors');

const WAY = {
    'RF-PRIVATE-NAME': 'keep the members that use #private names together in the facade',
    'RF-CLASS-FIELD': 'fields stay with the constructor; remove it from the part',
    'RF-LOCATION-SENSITIVE': 'place that part in the source directory ("directory": ".")',
    'RF-DYNAMIC-REQUIRE': 'keep it in the facade',
    'RF-COMPUTED-THIS': 'review manually; accept it in the recipe with { "code": "RF-COMPUTED-THIS", "member": …, "reason": … }',
    'RF-MUTABLE-STATE': 'keep every user of that binding in one destination (list it in that part\'s declarations, or keep the members in the facade)',
    'RF-SIDE-EFFECT': 'keep it, and the members that use it, in the facade',
    'RF-NAME-COLLISION': 'rename the part',
    'RF-TS-CLASS': 'split-class is not supported for TypeScript in v1 (research R13); split-module or a JavaScript host',
    'RF-SOURCE-CHANGED': 're-run plan',
    'RF-RAISE-REQUIRED': 'add { "part": …, "reason": … } to the recipe\'s raises, or regroup',
    'RF-PART-CYCLE': 'regroup: keep the declarations that read each other at load in one destination',
};

function refusal(code, name, line, message) {
    return { code, name, line, message, wayForward: WAY[code] };
}

// Recipe names against the inventory: every member and declaration exists, the host is the exported class.
function validateRecipe(recipe, inventory) {
    const host = inventory.classes.find((c) => c.name === recipe.host);
    if (!host) throw usageError(`host "${recipe.host}" is not a class declared in ${inventory.file}`);
    if (inventory.exportedClass !== recipe.host) {
        throw usageError(`host "${recipe.host}" is not the exported class of ${inventory.file} (${inventory.exportedClass ? `"${inventory.exportedClass}" is` : 'no class is exported'})`);
    }
    const memberNames = new Set(host.members.map((m) => m.name));
    const declarationNames = new Set(inventory.declarations.flatMap((d) => d.names));
    for (const part of recipe.parts) {
        for (const name of part.members) {
            if (!memberNames.has(name)) throw usageError(`parts (${part.name}): unknown member "${name}" of ${recipe.host}`);
        }
        for (const name of part.declarations) {
            if (!declarationNames.has(name)) throw usageError(`parts (${part.name}): unknown top-level declaration "${name}"`);
            const record = inventory.declarations.find((d) => d.names.includes(name));
            if (record.kind === 'import' || record.kind === 'require') throw usageError(`parts (${part.name}): "${name}" is an import; imports are carried automatically`);
            if (record.kind === 'class' && name === recipe.host) throw usageError(`parts (${part.name}): the host class cannot be a moved declaration`);
        }
    }
    for (const name of recipe.keep) {
        if (!memberNames.has(name) && !declarationNames.has(name)) throw usageError(`keep: "${name}" is neither a member of ${recipe.host} nor a top-level declaration`);
    }
    for (const entry of recipe.accept) {
        if (!memberNames.has(entry.member)) throw usageError(`accept: "${entry.member}" is not a member of ${recipe.host}`);
    }
    return host;
}

// split-module recipe names against the inventory: every listed declaration and every kept name exists, imports
// are never listed (they are carried), and a statement declaring several names moves as one.
function validateModuleRecipe(recipe, inventory) {
    const byName = new Map();
    for (const d of inventory.declarations) for (const n of d.names) byName.set(n, d);
    for (const part of recipe.parts) {
        for (const name of part.declarations) {
            const record = byName.get(name);
            if (!record) throw usageError(`parts (${part.name}): unknown top-level declaration "${name}"`);
            if (record.kind === 'import' || record.kind === 'require') throw usageError(`parts (${part.name}): "${name}" is an import; imports are carried automatically`);
            if (record.kind === 'statement') throw usageError(`parts (${part.name}): "${name}" is not a movable declaration`);
            const missing = record.names.filter((n) => !part.declarations.includes(n));
            if (missing.length > 0) throw usageError(`parts (${part.name}): "${record.names.join(', ')}" is one statement; list ${missing.join(', ')} in the same part or none of them`);
        }
    }
    for (const name of recipe.keep) {
        if (!byName.has(name)) throw usageError(`keep: "${name}" is not a top-level declaration`);
    }
}

// Per-member and per-part checks. parts[]: { name, dir, file, members: [member records] }.
function checkMembers({ recipe, inventory, sourceDir, parts, fileExists, previousOutputs }) {
    const refusals = [];
    const accepted = new Map(recipe.accept.map((a) => [`${a.code}:${a.member}`, a]));
    for (const part of parts) {
        const sameDir = part.dir === sourceDir;
        for (const member of part.members) {
            const line = member.span.startLine;
            if (member.private) refusals.push(refusal('RF-PRIVATE-NAME', member.name, line, `#${member.name} is a private member and cannot leave the class body`));
            for (const p of member.privateNames) refusals.push(refusal('RF-PRIVATE-NAME', member.name, p.line, `${member.name} uses #${p.name}, which cannot be reached from another class body`));
            if (member.kind === 'field') refusals.push(refusal('RF-CLASS-FIELD', member.name, line, `${member.name} is a class field (an instance initialiser)`));
            if (!sameDir) {
                for (const loc of member.locationSensitive) refusals.push(refusal('RF-LOCATION-SENSITIVE', member.name, loc.line, `${member.name} reads ${loc.text}; ${part.file} is not in the source directory, so its value would change`));
            }
            for (const dyn of member.dynamic) refusals.push(refusal('RF-DYNAMIC-REQUIRE', member.name, dyn.line, `${member.name} calls ${dyn.text} with a non-literal specifier`));
            for (const ct of member.computedThis) {
                const acceptance = accepted.get(`RF-COMPUTED-THIS:${member.name}`);
                if (!acceptance) refusals.push(refusal('RF-COMPUTED-THIS', member.name, ct.line, `${member.name} uses ${ct.text}; the target may live in any part`));
            }
        }
        for (const declaration of part.declarations) {
            if (!sameDir) {
                for (const loc of declaration.locationSensitive) refusals.push(refusal('RF-LOCATION-SENSITIVE', declaration.names.join(', '), loc.line, `${declaration.names.join(', ')} reads ${loc.text}; ${part.file} is not in the source directory`));
            }
            for (const dyn of declaration.dynamic) refusals.push(refusal('RF-DYNAMIC-REQUIRE', declaration.names.join(', '), dyn.line, `${declaration.names.join(', ')} calls ${dyn.text} with a non-literal specifier`));
        }
        if (fileExists(part.file) && !previousOutputs.has(part.file)) {
            refusals.push(refusal('RF-NAME-COLLISION', part.name, 0, `${part.file} already exists and is not this recipe's output`));
        }
        const carriedNames = new Set(part.imports.flatMap((imp) => imp.names));
        if (carriedNames.has(part.name) || part.name === recipe.host) {
            refusals.push(refusal('RF-NAME-COLLISION', part.name, 0, `the part class ${part.name} collides with a binding it carries`));
        }
    }
    return refusals;
}

module.exports = { refusal, validateRecipe, validateModuleRecipe, checkMembers, WAY };
