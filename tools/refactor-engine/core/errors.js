'use strict';

// Exit codes (contracts/cli.md), shared with arch-governance so a hook treats both toolkits alike:
//   0 success · 1 a host verification command failed · 2 toolkit finding
//   3 toolkit dependencies not installed (the ONLY code a hook may skip on) · 4 usage, config or recipe error

const EXIT = Object.freeze({ OK: 0, COMMAND_FAILED: 1, FINDING: 2, MISSING_DEPENDENCY: 3, USAGE: 4 });

class ToolkitError extends Error {
    constructor(message, exitCode, details = undefined) {
        super(message);
        this.name = 'ToolkitError';
        this.exitCode = exitCode;
        if (details !== undefined) this.details = details;
    }
}

const usageError = (message, details) => new ToolkitError(message, EXIT.USAGE, details);
const missingDependency = (message, details) => new ToolkitError(message, EXIT.MISSING_DEPENDENCY, details);
const findingError = (message, details) => new ToolkitError(message, EXIT.FINDING, details);
const commandFailed = (message, details) => new ToolkitError(message, EXIT.COMMAND_FAILED, details);

// Precedence when several outcomes apply: 4 > 3 > 2 > 1 > 0. A code outside 0..4 is a defect in the
// caller and is reported as 4, never folded into success.
const PRECEDENCE = [EXIT.USAGE, EXIT.MISSING_DEPENDENCY, EXIT.FINDING, EXIT.COMMAND_FAILED];

function resolveExit(codes) {
    if (codes.some((code) => !Number.isInteger(code) || code < 0 || code > 4)) return EXIT.USAGE;
    for (const code of PRECEDENCE) if (codes.includes(code)) return code;
    return EXIT.OK;
}

module.exports = { EXIT, ToolkitError, usageError, missingDependency, findingError, commandFailed, resolveExit };
