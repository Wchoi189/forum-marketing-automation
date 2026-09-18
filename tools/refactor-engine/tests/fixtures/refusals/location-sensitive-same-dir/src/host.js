'use strict';

const path = require('node:path');

class Host {
    tokenPath() {
        return path.join(__dirname, 'token.json');
    }

    other() {
        return 2;
    }
}

module.exports = Host;
