'use strict';

const Orders = require('./orders');

module.exports = () => new Orders().count();
