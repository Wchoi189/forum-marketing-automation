'use strict';

class Host {
    load(name) {
        return require(name);
    }

    other() {
        return 2;
    }
}

module.exports = Host;
