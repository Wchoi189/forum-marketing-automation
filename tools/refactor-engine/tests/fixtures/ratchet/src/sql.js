'use strict';

const UPDATE_NAME = 'UPDATE t SET name = COALESCE(?, name) WHERE id = ?';
const UPDATE_NOTE = 'UPDATE t SET note = COALESCE( ?, note) WHERE id = ?';

module.exports = { UPDATE_NAME, UPDATE_NOTE };
