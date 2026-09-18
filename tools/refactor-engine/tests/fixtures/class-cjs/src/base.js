'use strict';

class Base {
    constructor(db) {
        this.db = db;
    }

    other() {
        return 'base-other';
    }
}

module.exports = Base;
