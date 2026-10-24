'use strict';

class Orders {
    constructor() {
        this.rows = [];
    }

    add(row) {
        this.rows.push(row);
        return row;
    }

    count() {
        return this.rows.length;
    }
}

module.exports = Orders;
