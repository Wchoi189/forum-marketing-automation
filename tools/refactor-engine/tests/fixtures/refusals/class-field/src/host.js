'use strict';

class Host {
    count = 0;

    bump() {
        this.count += 1;
        return this.count;
    }
}

module.exports = Host;
