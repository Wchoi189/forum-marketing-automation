import Base from './base.js';
// >>> refactor-engine:parts BEGIN — generated; do not edit
import Posting from './parts/Posting.js';
import Reporting from './parts/Reporting.js';
import { SCALE } from './parts/_shared.js';
// <<< refactor-engine:parts END

export default class Ledger extends Base {
    constructor(db) {
        super(db);
        this.entries = [];
        this.scale = SCALE;
    }

    static fromRows(db, rows) {
        const ledger = new Ledger(db);
        for (const row of rows) ledger.addEntry(row.amount, row.note);
        return ledger;
    }
}

// >>> refactor-engine:parts BEGIN — generated; do not edit (refactor-engine verify --drift-only)
// _put, addEntry, describe ........ ./parts/Posting.js
// total, summary, label ........... ./parts/Reporting.js
for (const Part of [Posting, Reporting]) {
    for (const key of Object.getOwnPropertyNames(Part.prototype)) {
        if (key !== 'constructor') Object.defineProperty(Ledger.prototype, key, Object.getOwnPropertyDescriptor(Part.prototype, key));
    }
}
// <<< refactor-engine:parts END

Ledger.toMinor = (value) => Math.round(Number(value || 0) * 100);
