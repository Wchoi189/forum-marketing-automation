'use strict';

// Reads the module object at call time, the way a route handler destructures a service inside the handler.
function render(rows) {
    const { formatAll } = require('../src/reports');
    return formatAll(rows);
}

module.exports = { render };
