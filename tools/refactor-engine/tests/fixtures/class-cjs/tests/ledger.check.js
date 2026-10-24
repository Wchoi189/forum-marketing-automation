'use strict';

// Behaviour of every member on an instance, including a private-by-convention method called directly (R2 #2).
// Runs unchanged before and after the split.

const assert = require('node:assert/strict');
const Ledger = require('../src/ledger');

const ledger = new Ledger('db1');
assert.equal(ledger.label, 'ledger:db1');
assert.deepEqual(ledger._put({ minor: 5, note: 'x' }), { minor: 5, note: 'x' });
assert.deepEqual(ledger.addEntry(1.5, '  first '), { minor: 150, note: 'first' });
assert.equal(ledger.total(), 155);
assert.equal(ledger.summary(), '     155 ledger:db1');
assert.equal(ledger.average(), 77.5);
assert.equal(ledger.describe(), '     155 ledger:db1 avg 77.5');
assert.equal(ledger.other(), 'base-other');

const built = Ledger.fromRows('db2', [{ amount: 2, note: 'a' }, { amount: 3, note: 'b' }]);
assert.equal(built.total(), 500);
assert.equal(Ledger.toMinor(1.234), 123);

assert.equal(Object.keys(Ledger.prototype).length, 0, 'prototype members stay non-enumerable');
assert.equal(typeof Object.getOwnPropertyDescriptor(Ledger.prototype, 'label').get, 'function', 'getter stays a getter');
console.log('ledger.check: ok');
