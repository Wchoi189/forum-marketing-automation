function main(items) {
    for (const item of items) {
        oldCall(item);
    }
    return 'oldCall(';
}

module.exports = { main };
