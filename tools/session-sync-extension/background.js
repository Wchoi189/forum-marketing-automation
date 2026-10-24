/**
 * ppomppu Session Sync — background service worker.
 *
 * The bot cannot log itself in: ppomppu's login form sits behind Cloudflare
 * Turnstile (KE-004). This browser can, because a person uses it. Whenever the
 * ppomppu login cookies change here (a login, a session renewal), push the
 * ppomppu cookies to POST /api/session/import. The bot verifies them before
 * saving, so a logged-out push never replaces a working session.
 *
 * Setup: `npm run session:sync-setup` writes config.local.json next to this
 * file; then load this directory unpacked in chrome://extensions.
 *
 * Badge: blank = synced, OFF = not logged in here, ! = bot saw the pushed
 * session logged out, KEY = secret rejected, NET = bot unreachable,
 * CFG = config missing, … = bot busy, retrying.
 */

const LOGIN_COOKIES = new Set(['PHPSESSID', 'pmn']);
const RESYNC_ALARM = 'resync';
const RETRY_ALARM = 'retry';
const RESYNC_MINUTES = 30;
const RETRY_MINUTES = 2;
const DEBOUNCE_MS = 3000;

let debounceTimer = null;

async function loadConfig() {
  const response = await fetch(chrome.runtime.getURL('config.local.json')).catch(() => null);
  if (!response || !response.ok) throw new Error('config.local.json missing: run npm run session:sync-setup, then reload the extension');
  const config = await response.json();
  if (!config.endpoint || !config.secret) throw new Error('config.local.json needs endpoint and secret');
  return config;
}

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `ppomppu Session Sync\n${title}` });
}

/** Hash of the login cookie values, so a session the bot already rejected is not re-sent. */
async function loginFingerprint(cookies) {
  const text = cookies
    .filter((c) => LOGIN_COOKIES.has(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join('\n');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function scheduleRetry() {
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
}

async function sync(trigger) {
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    setBadge('CFG', '#b00020', err.message);
    return;
  }

  const cookies = await chrome.cookies.getAll({ domain: 'ppomppu.co.kr' });
  if (!cookies.some((c) => LOGIN_COOKIES.has(c.name))) {
    setBadge('OFF', '#757575', 'Not logged in to ppomppu in this browser. Log in once; the bot is updated automatically.');
    return;
  }

  const fingerprint = await loginFingerprint(cookies);
  const { rejectedFingerprint } = await chrome.storage.local.get('rejectedFingerprint');
  if (fingerprint === rejectedFingerprint) {
    setBadge('!', '#e65100', 'The bot saw this session logged out. Log in to ppomppu again in this browser.');
    return;
  }

  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ cookies, source: config.source ?? 'chrome-extension' }),
    });
  } catch {
    setBadge('NET', '#b00020', `Bot unreachable at ${config.endpoint}; retrying in ${RETRY_MINUTES} min.`);
    scheduleRetry();
    return;
  }

  const body = await response.json().catch(() => ({}));
  const at = new Date().toLocaleString();
  if (response.ok) {
    setBadge('', '#2e7d32', `Last sync ${at}: ${body.status}`);
  } else if (response.status === 409) {
    setBadge('…', '#757575', `Bot busy (${body.error}); retrying in ${RETRY_MINUTES} min.`);
    scheduleRetry();
  } else if (response.status === 422) {
    await chrome.storage.local.set({ rejectedFingerprint: fingerprint });
    setBadge('!', '#e65100', 'The bot saw this session logged out. Log in to ppomppu again in this browser.');
  } else if (response.status === 401 || response.status === 503) {
    setBadge('KEY', '#b00020', `Secret rejected (${body.error}). Re-run npm run session:sync-setup, restart the bot, reload the extension.`);
  } else {
    setBadge('ERR', '#b00020', `HTTP ${response.status} ${body.error ?? ''}; retrying in ${RETRY_MINUTES} min.`);
    scheduleRetry();
  }
  await chrome.storage.local.set({ lastSync: { at, trigger, httpStatus: response.status, result: body.status ?? body.error } });
}

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed || !LOGIN_COOKIES.has(cookie.name) || !cookie.domain.endsWith('ppomppu.co.kr')) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void sync('cookie_changed'), DEBOUNCE_MS);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESYNC_ALARM || alarm.name === RETRY_ALARM) void sync(alarm.name);
});

function start(trigger) {
  chrome.alarms.create(RESYNC_ALARM, { periodInMinutes: RESYNC_MINUTES });
  void sync(trigger);
}

chrome.runtime.onInstalled.addListener(() => start('installed'));
chrome.runtime.onStartup.addListener(() => start('startup'));
