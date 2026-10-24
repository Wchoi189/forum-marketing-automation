'use strict';

function pad(text, width) {
    return String(text).padStart(width, ' ');
}

module.exports = { pad };
