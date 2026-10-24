'use strict';

let counter = 0;

function bump() {
    counter += 1;
    return counter;
}

function read() {
    return counter;
}

module.exports = { bump, read };
