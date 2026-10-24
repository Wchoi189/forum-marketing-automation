'use strict';

const EXIT = {
  OK: 0,
  VIOLATION: 1,
  NOT_INSTALLED: 3,
  CONFIG_ERROR: 4,
};

class ToolkitError extends Error {
  constructor(message, exitCode = EXIT.VIOLATION) {
    super(message);
    this.name = 'ToolkitError';
    this.exitCode = exitCode;
  }
}

module.exports = { EXIT, ToolkitError };
