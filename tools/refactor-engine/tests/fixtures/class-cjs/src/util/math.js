'use strict';

function round(value, places) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

module.exports = { round };
