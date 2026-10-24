'use strict';

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const RULE = 'ARCH-003';
const URL_HOST = /https?:\/\/([A-Za-z0-9.-]+)/g;

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Every host a source line names, lower-cased, with the first-seen order of its occurrences kept.
function scanRoots({ roots, include, exclude }, cwd) {
  const occurrences = new Map();
  let files = 0;
  for (const root of roots) {
    const rootDir = path.resolve(cwd, root);
    const matches = fg.sync(include, { cwd: rootDir, ignore: exclude, absolute: false, onlyFiles: true }).sort();
    for (const file of matches) {
      files += 1;
      const display = `${root.replace(/\/+$/, '')}/${file}`;
      const lines = fs.readFileSync(path.join(rootDir, file), 'utf8').split('\n');
      lines.forEach((text, index) => {
        for (const match of text.matchAll(URL_HOST)) {
          const host = match[1].toLowerCase().replace(/\.+$/, '');
          if (host === '') continue;
          if (!occurrences.has(host)) occurrences.set(host, []);
          occurrences.get(host).push(`${display}:${index + 1}`);
        }
      });
    }
  }
  return { files, occurrences };
}

// ARCH-003: (a) every host named in source is declared on a node or ignored with a reason;
// (b) every declared host is still named somewhere in source.
function checkEgressCoverage(model, coverage, cwd = process.cwd()) {
  const { files, occurrences } = scanRoots(coverage, cwd);
  const ignored = new Set(coverage.ignoreHosts.map((entry) => entry.host));
  const declared = new Map();
  for (const [id, node] of model.nodes) {
    for (const host of node.hosts) declared.set(host.toLowerCase(), id);
  }

  const findings = [];
  for (const [host, locations] of occurrences) {
    if (declared.has(host) || ignored.has(host)) continue;
    const more = locations.length > 1 ? ` (+${locations.length - 1} more)` : '';
    findings.push({ rule: RULE, subject: `unmapped host ${host}`, location: `${locations[0]}${more}` });
  }
  for (const [host, id] of declared) {
    if (!occurrences.has(host)) {
      findings.push({ rule: RULE, subject: `declared host unused ${host}`, location: `node ${id}` });
    }
  }

  return {
    rule: RULE,
    target: `egress coverage (${plural(files, 'file')}, ${plural(occurrences.size, 'host')})`,
    findings,
  };
}

module.exports = { checkEgressCoverage };
