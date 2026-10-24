'use strict';

function lookup(db, ids) {
    for (const id of ids) {
        db.prepare('SELECT 1').get(id);
    }
}

function names(db) {
    return db.prepare('SELECT name FROM t').all().map((r) => r.name);
}

function insertAll(db, items) {
    const insertStmt = db.prepare('INSERT INTO t VALUES (?)');
    db.transaction(() => {
        for (const item of items) insertStmt.run(item);
    })();
}

function runChecks(db, checks) {
    for (const check of checks) check.run(db);
}

module.exports = { lookup, names, insertAll, runChecks };
