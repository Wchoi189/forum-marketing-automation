'use strict';

const path = require('node:path');
const { pad } = require('./util/format');

const tokenPath = path.join(__dirname, 'token.json');

function getAuthClient() {
    return { token: tokenPath };
}

function getSheetsClient() {
    return { kind: 'sheets', auth: getAuthClient() };
}

function getDriveClient() {
    return { kind: 'drive', auth: getAuthClient() };
}

// ─── Palette ─────────────────────────────────────────────────────────────────
const BG = { ok: 'green', warn: 'amber' };
const FG = { ok: 'black', warn: 'white' };

function colIndexToLetter(index) {
    return String.fromCharCode(65 + index);
}

// ─── Rule builders ───────────────────────────────────────────────────────────
function buildTextRule(column, value) {
    return { column: colIndexToLetter(column), value, bg: BG[value], fg: FG[value] };
}

function buildRangeRule(column, min, max) {
    return { column: colIndexToLetter(column), min, max };
}

// ─── Formatting ──────────────────────────────────────────────────────────────
function formatAll(rows) {
    return rows.map((row) => formatRow(row));
}

function formatRow(row) {
    return pad(row.label, 6) + ' ' + buildTextRule(row.column, row.state).bg;
}

function applyBanding(rows) {
    return rows.map((row, index) => ({ ...row, band: index % 2 }));
}

// ─── Reports ─────────────────────────────────────────────────────────────────
function createReport(rows) {
    return { client: getSheetsClient(), lines: formatAll(rows) };
}

/**
 * Calls formatAll through the local binding: a spy installed on the module object is never seen here,
 * exactly as in the unsplit file.
 */
function createColored(rows) {
    const report = createReport(rows);
    report.lines = formatAll(applyBanding(rows));
    return report;
}

function exportArchive(rows) {
    return { client: getDriveClient(), rules: [buildRangeRule(0, 1, 9)], count: rows.length };
}

module.exports = {
    tokenPath,
    getAuthClient,
    getSheetsClient,
    getDriveClient,
    colIndexToLetter,
    buildTextRule,
    buildRangeRule,
    formatAll,
    applyBanding,
    createReport,
    createColored,
    exportArchive,
};
