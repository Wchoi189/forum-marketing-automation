'use strict';

// Advisory clusters (data-model.md §1 affinity[]): an undirected graph over a class's members with an edge for a
// `this.x()` call to another member and an edge between two members touching the same `this.<field>`. Edges to
// members referenced by more than half of all members are dropped first — a helper everyone calls says nothing
// about grouping. Printed by `inventory`; never imported by the planner or apply (a test asserts it).

function clusters(members) {
    const named = members.filter((m) => m.kind !== 'constructor');
    if (named.length === 0) return [];
    const memberNames = new Set(named.map((m) => m.name));
    const referencedBy = new Map(); // member name -> Set of referencing member names
    const fieldUsers = new Map(); // field -> Set of member names
    for (const m of named) {
        for (const ref of m.thisRefs) {
            if (memberNames.has(ref.name)) {
                if (ref.name === m.name) continue;
                if (!referencedBy.has(ref.name)) referencedBy.set(ref.name, new Set());
                referencedBy.get(ref.name).add(m.name);
            } else {
                if (!fieldUsers.has(ref.name)) fieldUsers.set(ref.name, new Set());
                fieldUsers.get(ref.name).add(m.name);
            }
        }
    }
    const hubs = new Set([...referencedBy].filter(([, users]) => users.size > named.length / 2).map(([name]) => name));

    const parent = new Map(named.map((m) => [m.name, m.name]));
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    const union = (a, b) => parent.set(find(a), find(b));
    for (const [target, users] of referencedBy) {
        if (hubs.has(target)) continue;
        for (const user of users) union(user, target);
    }
    // A field every member touches (`this.db`) groups nothing; it is reported, not joined on.
    const hubFields = new Set([...fieldUsers].filter(([, users]) => users.size > named.length / 2).map(([field]) => field));
    const sharedFields = new Map(); // root -> Set of fields
    for (const [field, users] of fieldUsers) {
        if (hubFields.has(field)) continue;
        const list = [...users];
        for (let i = 1; i < list.length; i += 1) union(list[0], list[i]);
    }
    const groups = new Map();
    for (const m of named) {
        const root = find(m.name);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(m.name);
    }
    for (const [field, users] of fieldUsers) {
        if (users.size < 2 || hubFields.has(field)) continue;
        const root = find([...users][0]);
        if (!sharedFields.has(root)) sharedFields.set(root, new Set());
        sharedFields.get(root).add(field);
    }
    const order = new Map(named.map((m, i) => [m.name, i]));
    return [...groups]
        .map(([root, names]) => ({ members: names.sort((a, b) => order.get(a) - order.get(b)), sharedFields: [...(sharedFields.get(root) || [])].sort(), hubs: [...hubs].filter((h) => names.includes(h)), hubFields: [...hubFields].sort() }))
        .sort((a, b) => b.members.length - a.members.length || order.get(a.members[0]) - order.get(b.members[0]));
}

module.exports = { clusters };
