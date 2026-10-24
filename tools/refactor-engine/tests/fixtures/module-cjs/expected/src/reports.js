'use strict';

// >>> refactor-engine:parts BEGIN — generated; do not edit
const { tokenPath, getAuthClient, getSheetsClient, getDriveClient } = require('./auth');
const { colIndexToLetter } = require('./parts/palette');
const { buildTextRule, buildRangeRule } = require('./parts/builders');
const { formatAll, applyBanding } = require('./parts/formatting');
const { createReport, createColored, exportArchive } = require('./parts/reports');
// <<< refactor-engine:parts END

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
