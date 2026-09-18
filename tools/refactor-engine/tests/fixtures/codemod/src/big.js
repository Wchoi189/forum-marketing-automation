function big(ok) {
    const a = 1;
    const b = 2;
    if (ok) {
        mark(a);
    }
    const c = 3;
    const d = 4;
    const e = 5;
    return a + b + c + d + e;
}

module.exports = { big };
