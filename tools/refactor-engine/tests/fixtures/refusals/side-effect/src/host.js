'use strict';

function load() {
    return new Map();
}

const cache = load();

class Host {
    lookup(key) {
        return cache.get(key);
    }

    other() {
        return 2;
    }
}

module.exports = Host;
