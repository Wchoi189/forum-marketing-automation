'use strict';

class Host {
    call(key) {
        return this[key]();
    }

    other() {
        return 2;
    }
}

module.exports = Host;
