'use strict';

// Exit codes, contracts/cli.md. The pre-commit hook treats ONLY `DEPENDENCIES` as "skip".
const EXIT = Object.freeze({
  OK: 0,
  CALM: 1,
  GUARDRAIL: 2,
  DEPENDENCIES: 3,
  USAGE: 4,
});

class ToolkitError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'ToolkitError';
    this.exitCode = exitCode;
  }
}

class ConfigError extends ToolkitError {
  constructor(message) {
    super(message, EXIT.USAGE);
    this.name = 'ConfigError';
  }
}

module.exports = { EXIT, ToolkitError, ConfigError };
