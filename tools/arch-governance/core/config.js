'use strict';

const fs = require('fs');
const path = require('path');
const { ConfigError } = require('./errors');

// Every key the toolkit reads. Anything else is refused: a misspelt rule must not silently
// disable itself. `patternBindings` is deliberately absent — pattern conformance is CALM-native.
const ROOT_KEYS = ['architecture', 'patternsDir', 'outputDir', 'docsBaseUrl', 'sizeBudgetBytes', 'rules'];
const RULE_KEYS = ['forbiddenConnections', 'egressOrigins', 'egressCoverage'];
const FORBIDDEN_KEYS = ['id', 'fromZone', 'fromNodeType', 'toZone', 'toNodeType', 'message'];
const ORIGIN_KEYS = ['toZone', 'allowedFromZones'];
const COVERAGE_KEYS = ['roots', 'include', 'exclude', 'ignoreHosts'];
const IGNORE_KEYS = ['host', 'reason'];

const DEFAULTS = { outputDir: 'dist/architecture', docsBaseUrl: '/' };

function fail(message) {
  throw new ConfigError(`config: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value, allowed, where) {
  if (!isObject(value)) fail(`${where || 'root'} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`unknown key "${where ? `${where}.${key}` : key}"`);
  }
}

function checkString(value, where) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${where} must be a non-empty string`);
}

function checkStringArray(value, where) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(`${where} must be an array of non-empty strings`);
  }
}

function checkExists(relative, kind, where, cwd) {
  let stat;
  try {
    stat = fs.statSync(path.resolve(cwd, relative));
  } catch {
    fail(`${where} "${relative}" does not exist`);
  }
  if (kind === 'file' && !stat.isFile()) fail(`${where} "${relative}" is not a file`);
  if (kind === 'dir' && !stat.isDirectory()) fail(`${where} "${relative}" is not a directory`);
}

function readForbiddenConnections(list) {
  const where = 'rules.forbiddenConnections';
  if (!Array.isArray(list)) fail(`${where} must be an array`);
  return list.map((entry, index) => {
    const at = `${where}[${index}]`;
    checkKeys(entry, FORBIDDEN_KEYS, at);
    checkString(entry.id, `${at}.id`);
    checkString(entry.message, `${at}.message`);
    for (const key of ['fromZone', 'fromNodeType', 'toZone', 'toNodeType']) {
      if (key in entry) checkString(entry[key], `${at}.${key}`);
    }
    if (!('fromZone' in entry) && !('fromNodeType' in entry)) fail(`${at} needs fromZone or fromNodeType`);
    if (!('toZone' in entry) && !('toNodeType' in entry)) fail(`${at} needs toZone or toNodeType`);
    return { ...entry };
  });
}

function readEgressOrigins(value) {
  const where = 'rules.egressOrigins';
  checkKeys(value, ORIGIN_KEYS, where);
  checkString(value.toZone, `${where}.toZone`);
  checkStringArray(value.allowedFromZones, `${where}.allowedFromZones`);
  return { toZone: value.toZone, allowedFromZones: [...value.allowedFromZones] };
}

function readEgressCoverage(value) {
  const where = 'rules.egressCoverage';
  checkKeys(value, COVERAGE_KEYS, where);
  checkStringArray(value.roots, `${where}.roots`);
  checkStringArray(value.include, `${where}.include`);
  if ('exclude' in value) checkStringArray(value.exclude, `${where}.exclude`);
  const ignoreHosts = value.ignoreHosts === undefined ? [] : value.ignoreHosts;
  if (!Array.isArray(ignoreHosts)) fail(`${where}.ignoreHosts must be an array`);
  ignoreHosts.forEach((entry, index) => {
    const at = `${where}.ignoreHosts[${index}]`;
    checkKeys(entry, IGNORE_KEYS, at);
    checkString(entry.host, `${at}.host`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      fail(`${at} ("${entry.host}") has no reason — every ignored host must say why`);
    }
  });
  return {
    roots: [...value.roots],
    include: [...value.include],
    exclude: value.exclude ? [...value.exclude] : [],
    ignoreHosts: ignoreHosts.map((entry) => ({ host: entry.host.toLowerCase(), reason: entry.reason })),
  };
}

function loadConfig(configPath, cwd = process.cwd()) {
  const absolute = path.resolve(cwd, configPath);
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    fail(`cannot read "${configPath}" (${error.code || error.message})`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`"${configPath}" is not valid JSON (${error.message})`);
  }

  checkKeys(raw, ROOT_KEYS, '');
  checkString(raw.architecture, 'architecture');
  checkExists(raw.architecture, 'file', 'architecture', cwd);
  checkString(raw.patternsDir, 'patternsDir');
  checkExists(raw.patternsDir, 'dir', 'patternsDir', cwd);
  if ('outputDir' in raw) checkString(raw.outputDir, 'outputDir');
  if ('docsBaseUrl' in raw) {
    checkString(raw.docsBaseUrl, 'docsBaseUrl');
    if (!raw.docsBaseUrl.startsWith('/') || !raw.docsBaseUrl.endsWith('/')) {
      fail(`docsBaseUrl "${raw.docsBaseUrl}" must start and end with "/"`);
    }
  }
  if ('sizeBudgetBytes' in raw && !(Number.isInteger(raw.sizeBudgetBytes) && raw.sizeBudgetBytes > 0)) {
    fail('sizeBudgetBytes must be a positive integer');
  }

  const rules = { forbiddenConnections: [], egressOrigins: null, egressCoverage: null };
  if ('rules' in raw) {
    checkKeys(raw.rules, RULE_KEYS, 'rules');
    if ('forbiddenConnections' in raw.rules) rules.forbiddenConnections = readForbiddenConnections(raw.rules.forbiddenConnections);
    if ('egressOrigins' in raw.rules) rules.egressOrigins = readEgressOrigins(raw.rules.egressOrigins);
    if ('egressCoverage' in raw.rules) rules.egressCoverage = readEgressCoverage(raw.rules.egressCoverage);
  }

  return {
    path: absolute,
    architecture: raw.architecture,
    patternsDir: raw.patternsDir,
    outputDir: raw.outputDir ?? DEFAULTS.outputDir,
    docsBaseUrl: raw.docsBaseUrl ?? DEFAULTS.docsBaseUrl,
    sizeBudgetBytes: raw.sizeBudgetBytes ?? null,
    rules,
  };
}

module.exports = { loadConfig };
