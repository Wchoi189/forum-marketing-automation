'use strict';

const path = require('node:path');

const tokenPath = path.join(__dirname, 'token.json');

function getAuthClient() {
    return { token: tokenPath };
}

function getSheetsClient() {
    return { auth: getAuthClient() };
}

function getDriveClient() {
    return { auth: getAuthClient() };
}

module.exports = { tokenPath, getAuthClient, getSheetsClient, getDriveClient };
