/**
 * One-time setup for automatic ppomppu session sync.
 *
 *   npm run session:sync-setup [-- --port 3000]
 *
 * 1. Ensures SESSION_IMPORT_SECRET exists in .env.docker (generates one if absent).
 * 2. Writes tools/session-sync-extension/config.local.json with the endpoint and
 *    that secret (gitignored, mode 0600).
 *
 * Then: `docker compose up -d app` so the container picks up the secret, and
 * load tools/session-sync-extension unpacked in chrome://extensions. The secret
 * is never printed.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.docker');
const EXTENSION_DIR = path.join(ROOT, 'tools', 'session-sync-extension');
const CONFIG_FILE = path.join(EXTENSION_DIR, 'config.local.json');
const KEY = 'SESSION_IMPORT_SECRET';

function parsePort(argv: string[]): number {
  const index = argv.indexOf('--port');
  const port = index >= 0 ? Number(argv[index + 1]) : 3000;
  if (!Number.isInteger(port) || port <= 0) throw new Error('--port must be a positive integer');
  return port;
}

function ensureSecret(): { secret: string; created: boolean } {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
  const match = text.match(new RegExp(`^${KEY}=(.+)$`, 'm'));
  if (match?.[1]?.trim()) return { secret: match[1].trim(), created: false };

  const secret = randomBytes(32).toString('base64url');
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(ENV_FILE, `${separator}${KEY}=${secret}\n`, { encoding: 'utf-8' });
  return { secret, created: true };
}

function main() {
  const port = parsePort(process.argv.slice(2));
  const { secret, created } = ensureSecret();
  const endpoint = `http://localhost:${port}/api/session/import`;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ endpoint, secret }, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });

  console.log(created ? 'session import secret generated in .env.docker' : 'session import secret already in .env.docker (reused)');
  console.log(`extension config written: ${path.relative(ROOT, CONFIG_FILE)} -> ${endpoint}`);
  if (created) console.log('restart the bot so it reads the secret: docker compose up -d app');
  console.log(`load the extension: chrome://extensions > Developer mode > Load unpacked > ${EXTENSION_DIR}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
