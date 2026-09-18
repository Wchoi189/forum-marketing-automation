'use strict';

const Base = require('./base');

class Ledger extends Base {
    constructor(db) {
        super(db);
        this.entries = [];
    }
}

// >>> refactor-engine:parts BEGIN — generated; do not edit (refactor-engine verify --drift-only)
// _put, addEntry, describe ........................ ./parts/Posting.js
// total, summary, label, fromRows, average ........ ./parts/Reporting.js
module.exports = Ledger;
for (const Part of [
    require('./parts/Posting'),
    require('./parts/Reporting'),
]) {
    for (const key of Object.getOwnPropertyNames(Part.prototype)) {
        if (key !== 'constructor') Object.defineProperty(Ledger.prototype, key, Object.getOwnPropertyDescriptor(Part.prototype, key));
    }
    for (const key of Object.getOwnPropertyNames(Part)) {
        if (!['length', 'name', 'prototype'].includes(key)) Object.defineProperty(Ledger, key, Object.getOwnPropertyDescriptor(Part, key));
    }
}
// <<< refactor-engine:parts END

Ledger.toMinor = (value) => Math.round(Number(value || 0) * 100);

module.exports = Ledger;
