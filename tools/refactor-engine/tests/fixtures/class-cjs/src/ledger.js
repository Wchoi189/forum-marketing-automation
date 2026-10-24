'use strict';

const Base = require('./base');
const { pad } = require('./util/format');
const { round } = require('./util/math');

// Used by one part only: it travels with that part because the recipe lists it.
function normalizeNote(note) {
    return String(note || '').trim();
}

class Ledger extends Base {
    constructor(db) {
        super(db);
        this.entries = [];
    }

    _put(entry) {
        this.entries.push(entry);
        return entry;
    }

    /**
     * Adds one entry. The amount is scaled by a static assigned after the class (the R3 case) and the
     * note is normalized by a top-level helper that moves with this part.
     */
    addEntry(amount, note) {
        const entry = { minor: Ledger.toMinor(amount), note: normalizeNote(note) };
        return this._put(entry);
    }

    describe() {
        return this.summary() + ' avg ' + this.average();
    }

    total() {
        return this.entries.reduce((sum, entry) => sum + entry.minor, 0);
    }

    summary() {
        return pad(this.total(), 8) + ' ' + this.label;
    }

    get label() {
        return 'ledger:' + this.db;
    }

    static fromRows(db, rows) {
        const ledger = new Ledger(db);
        for (const row of rows) ledger.addEntry(row.amount, row.note);
        return ledger;
    }

    average() {
        if (this.entries.length === 0) return 0;
        return round(this.total() / this.entries.length, 2);
    }
}

Ledger.toMinor = (value) => Math.round(Number(value || 0) * 100);

module.exports = Ledger;
