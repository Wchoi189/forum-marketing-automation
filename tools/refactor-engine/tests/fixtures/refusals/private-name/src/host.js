'use strict';

class Host {
    #secret = 1;

    reveal() {
        return this.#secret;
    }

    other() {
        return 2;
    }
}

module.exports = Host;
