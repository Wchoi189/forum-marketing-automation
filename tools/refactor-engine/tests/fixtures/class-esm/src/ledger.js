import Base from './base.js';
import { pad } from './util/format.js';

// Used by the constructor (facade) and by a moved member: hoisted to the shared part.
const SCALE = 100;

function normalizeNote(note) {
    return String(note || '').trim();
}

export default class Ledger extends Base {
    constructor(db) {
        super(db);
        this.entries = [];
        this.scale = SCALE;
    }

    _put(entry) {
        this.entries.push(entry);
        return entry;
    }

    /**
     * Adds one entry, scaled by a static assigned after the class (the R3 case).
     */
    addEntry(amount, note) {
        const entry = { minor: Ledger.toMinor(amount) * this.scale / SCALE, note: normalizeNote(note) };
        return this._put(entry);
    }

    describe() {
        return this.summary() + ' n=' + this.entries.length;
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
}

Ledger.toMinor = (value) => Math.round(Number(value || 0) * 100);
