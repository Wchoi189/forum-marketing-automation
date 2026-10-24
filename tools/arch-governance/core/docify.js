'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EXIT, ToolkitError } = require('./errors');
const { TOOLKIT_DIR, runCalm } = require('./calmRunner');

// The package.json docify generated when the pinned lockfile was made, and that lockfile.
const PINNED_DIR = path.join(TOOLKIT_DIR, 'docify');
const BASE_URL_LITERAL = "baseUrl: '/'";
// Docusaurus does not prefix `stylesheets` entries with baseUrl, so the template's root-absolute
// stylesheet would resolve outside the mount path.
const STYLESHEET_LITERAL = "'/css/custom.css'";

function templateChanged(detail) {
  return new ToolkitError(`docify template changed: ${detail}`, EXIT.CALM);
}

function replaceExactlyOnce(text, literal, replacement, what) {
  const count = text.split(literal).length - 1;
  if (count !== 1) {
    throw templateChanged(`${what} literal not found (expected exactly one ${literal}, found ${count})`);
  }
  return text.replace(literal, () => replacement);
}

// A CALM upgrade that moves or duplicates the literal must fail loudly, not publish a site whose
// assets 404 under the mount path.
function rewriteBaseUrl(configText, baseUrl) {
  return replaceExactlyOnce(configText, BASE_URL_LITERAL, `baseUrl: '${baseUrl}'`, 'baseUrl');
}

function rewriteStylesheet(configText, baseUrl) {
  return replaceExactlyOnce(configText, STYLESHEET_LITERAL, `'${baseUrl}css/custom.css'`, 'stylesheet');
}

// Exit status is read from each child directly; output is inherited so a long install shows progress.
function runStep(label, command, args, cwd) {
  process.stderr.write(`docify: ${label}\n`);
  const result = spawnSync(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw new ToolkitError(`${label} failed to start: ${result.error.message}`, EXIT.CALM);
  if (result.status !== 0) throw new ToolkitError(`${label} exited ${result.status}`, EXIT.CALM);
}

function runDocify({ architecture, outputDir, baseUrl, build }) {
  const out = path.resolve(outputDir);
  const site = path.join(out, 'site');

  const generated = runCalm(['docify', '-a', architecture, '-o', site, '--clear-output-directory']);
  if (generated.exitCode !== 0) {
    process.stderr.write(`${generated.stderr}\n`);
    throw new ToolkitError(`calm docify exited ${generated.exitCode}`, EXIT.CALM);
  }

  const configPath = path.join(site, 'docusaurus.config.js');
  fs.writeFileSync(configPath, rewriteStylesheet(rewriteBaseUrl(fs.readFileSync(configPath, 'utf8'), baseUrl), baseUrl));
  process.stderr.write(`docify: site source ${path.relative(process.cwd(), site) || '.'} (baseUrl ${baseUrl})\n`);
  if (!build) return EXIT.OK;

  const pinnedManifest = fs.readFileSync(path.join(PINNED_DIR, 'package.json'));
  if (!fs.readFileSync(path.join(site, 'package.json')).equals(pinnedManifest)) {
    throw templateChanged('generated package.json no longer matches the pinned lockfile');
  }
  fs.copyFileSync(path.join(PINNED_DIR, 'package-lock.json'), path.join(site, 'package-lock.json'));

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  runStep('npm ci', npm, ['ci', '--no-audit', '--no-fund'], site);
  runStep('docusaurus build', npx, ['--no-install', 'docusaurus', 'build', '--out-dir', '../build'], site);
  process.stderr.write(`docify: built ${path.relative(process.cwd(), path.join(out, 'build')) || '.'}\n`);
  return EXIT.OK;
}

module.exports = { rewriteBaseUrl, rewriteStylesheet, runDocify };
