'use strict';

const A_BASE = 1;

// Read by part `a` at load, and reads part `a` at load: the two parts cannot be loaded in either order.
const B_BASE = A_BASE + 1;

const A = B_BASE + 1;

module.exports = { A, B_BASE };
