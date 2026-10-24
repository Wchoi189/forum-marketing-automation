'use strict';

let counter = 0;

class Host {
    bump() {
        counter += 1;
        return counter;
    }

    read() {
        return counter;
    }
}

module.exports = Host;
