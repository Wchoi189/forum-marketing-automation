#!/usr/bin/env node
'use strict';

// SC-6 / FR-9.2: the toolkit runs unmodified in a directory that is not this repository.
// A plain script, not a *.test.js: it installs the CALM CLI (~300 MB), so `node --test` must never
// pick it up. Run it directly: node tools/arch-governance/tests/verify-portability.js
// Every exit status is read from the child directly, never through a pipe.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOLKIT = path.resolve(__dirname, '..');
const REPO_ROOT = gitRoot() ?? path.resolve(TOOLKIT, '..', '..');

function gitRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: TOOLKIT, encoding: 'utf8' });
  return r.status === 0 ? fs.realpathSync(r.stdout.trim()) : null;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const HOST = 'api.portable.example.net';

// Two nodes, one relationship: enough to exercise every validate stage, including ARCH-002
// (the service's zone is an allowed origin) and ARCH-003 (the one declared host is named in source).
const MODEL = {
  $schema: 'https://calm.finos.org/release/1.0/meta/calm.json',
  'unique-id': 'portable-probe',
  name: 'Portable probe',
  description: 'Two-node architecture used only by verify-portability.js.',
  nodes: [
    {
      'unique-id': 'worker',
      'node-type': 'service',
      name: 'Worker',
      description: 'Calls one external API.',
      metadata: { zone: 'container' },
    },
    {
      'unique-id': 'remote-api',
      'node-type': 'system',
      name: 'Remote API',
      description: 'An external HTTP API.',
      metadata: { zone: 'external', hosts: [HOST] },
    },
  ],
  relationships: [
    {
      'unique-id': 'rel-worker-remote',
      description: 'Worker calls the remote API.',
      protocol: 'HTTPS',
      'relationship-type': {
        connects: { source: { node: 'worker' }, destination: { node: 'remote-api' } },
      },
    },
  ],
};

const CONFIG = {
  architecture: 'docs/architecture/system.calm.json',
  patternsDir: 'docs/architecture/patterns',
  rules: {
    egressOrigins: { toZone: 'external', allowedFromZones: ['container'] },
    egressCoverage: { roots: ['src'], include: ['**/*.js'], exclude: ['**/node_modules/**'] },
  },
};

function main() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arch-portability-')));
  try {
    if (isInside(tmp, REPO_ROOT)) {
      process.stderr.write(`verify-portability: temp dir ${tmp} is inside the repository ${REPO_ROOT}\n`);
      return 1;
    }
    process.stderr.write(`verify-portability: ${tmp}\n`);

    const copy = path.join(tmp, 'toolkit');
    const skip = path.join(TOOLKIT, 'node_modules');
    fs.cpSync(TOOLKIT, copy, { recursive: true, filter: (src) => !isInside(src, skip) });

    const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: copy, stdio: 'inherit' });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      process.stderr.write(`verify-portability: npm ci exited ${install.status}\n`);
      return install.status ?? 1;
    }

    // The host project: default config location, an empty patterns dir, one source file.
    writeJson(path.join(tmp, 'docs', 'architecture', 'arch-governance.config.json'), CONFIG);
    writeJson(path.join(tmp, CONFIG.architecture), MODEL);
    fs.mkdirSync(path.join(tmp, CONFIG.patternsDir), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.js'), `'use strict';\n\nmodule.exports = { URL: 'https://${HOST}/v1' };\n`);

    const run = spawnSync(process.execPath, [path.join(copy, 'bin', 'arch-governance.js'), 'validate', '--strict'], {
      cwd: tmp,
      stdio: 'inherit',
    });
    if (run.error) throw run.error;
    process.stderr.write(`verify-portability: validate --strict exited ${run.status}\n`);
    return run.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

process.exitCode = main();
