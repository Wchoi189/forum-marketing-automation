'use strict';

const fs   = require('node:fs');
const path = require('node:path');

/**
 * Minimal glob implementation supporting a single wildcard in filename component.
 * No recursive wildcard support. Handles glob patterns with literal or wildcard segments.
 *
 * @param {string} pattern - Glob pattern (relative to cwd)
 * @param {string} [cwd] - Base directory (defaults to process.cwd())
 * @returns {string[]} Matched file paths (relative to cwd)
 */
function globSync(pattern, cwd) {
  if (!cwd) cwd = process.cwd();
  const parts = pattern.split('/');
  return walkDir(cwd, parts, '');
}

function walkDir(base, parts, prefix) {
  if (parts.length === 0) return [];

  const head = parts[0];
  const rest = parts.slice(1);
  const results = [];

  if (head.indexOf('*') === -1) {
    // Literal path segment
    const fullPath = path.join(base, head);
    if (rest.length === 0) {
      if (fs.existsSync(fullPath)) {
        results.push(prefix ? prefix + '/' + head : head);
      }
    } else if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const next = prefix ? prefix + '/' + head : head;
      const sub = walkDir(fullPath, rest, next);
      for (let i = 0; i < sub.length; i++) results.push(sub[i]);
    }
  } else {
    // Wildcard segment
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return [];
    const entries = fs.readdirSync(base);
    const regexSrc = '^' + head.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    const regex = new RegExp(regexSrc);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!regex.test(entry)) continue;
      const fullPath = path.join(base, entry);
      const rel = prefix ? prefix + '/' + entry : entry;
      if (rest.length === 0) {
        if (fs.statSync(fullPath).isFile()) results.push(rel);
      } else if (fs.statSync(fullPath).isDirectory()) {
        const sub = walkDir(fullPath, rest, rel);
        for (let j = 0; j < sub.length; j++) results.push(sub[j]);
      }
    }
  }

  return results;
}

module.exports = { globSync };
