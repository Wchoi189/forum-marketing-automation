/**
 * lib/session/consolePage.ts
 *
 * The viewer for the login console: a self-contained page (no build step, no
 * dashboard bundle) that shows the server browser's screencast and forwards
 * taps and typed text. Sized for a phone.
 */

/**
 * Entry page without a token. Two ways in:
 *  - "Open here": POST /api/session/console with SESSION_IMPORT_SECRET, then go
 *    to the console in this window. No Slack needed. The secret comes from the
 *    password field, from this device's storage, or from the URL fragment
 *    (`#key=…`, never sent to the server), so a bookmark opens it in one tap.
 *  - "Send to Slack": no auth, because the link goes to Slack only.
 */
export function renderConsoleRequestPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ppomppu login</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f5; --fg: #1a1a1a; --muted: #666; --panel: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #eee; --muted: #aaa; --panel: #1e1e1e; } }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 440px; margin: 0 auto; padding: 24px 16px; }
  button { width: 100%; padding: 14px; font-size: 16px; border-radius: 8px; border: 0; background: #e65100; color: #fff; }
  button.secondary { background: var(--panel); color: var(--fg); border: 1px solid #8886; }
  input[type=password] { box-sizing: border-box; width: 100%; padding: 12px; font-size: 16px; border-radius: 8px; border: 1px solid #8886; background: var(--panel); color: var(--fg); margin-bottom: 10px; }
  label { display: block; margin-bottom: 10px; color: var(--muted); }
  p { color: var(--muted); }
  hr { border: 0; border-top: 1px solid #8884; margin: 24px 0; }
</style>
</head>
<body>
<main>
  <h1>ppomppu login</h1>
  <p>Restores the bot's ppomppu session. The server opens its own browser on the login page with the ID and password filled in; tap the security check, then 로그인.</p>
  <form id="open" autocomplete="on">
    <input type="text" name="username" value="ppomppu-console" autocomplete="username" hidden>
    <input id="key" type="password" name="password" autocomplete="current-password" placeholder="Console key (SESSION_IMPORT_SECRET)">
    <label><input id="remember" type="checkbox" checked> Remember on this device</label>
    <button type="submit">Open login console here</button>
  </form>
  <p id="out"></p>
  <hr>
  <button id="slack" class="secondary">Send login link to Slack instead</button>
</main>
<script>
  const out = document.getElementById('out');
  const keyInput = document.getElementById('key');
  const STORE = 'ppomppu-console-key';
  const stored = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
  const remember = (key) => { try { key ? localStorage.setItem(STORE, key) : localStorage.removeItem(STORE); } catch {} };
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('key');
  keyInput.value = fromHash || stored() || '';

  async function openHere() {
    const key = keyInput.value.trim();
    if (!key) { out.textContent = 'Enter the console key first.'; keyInput.focus(); return; }
    out.textContent = 'Opening the server browser…';
    const res = await fetch('/api/session/console', { method: 'POST', headers: { Authorization: 'Bearer ' + key } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) {
      remember(document.getElementById('remember').checked ? key : null);
      location.assign('/session/console/' + encodeURIComponent(body.token));
      return;
    }
    if (res.status === 401) remember(null);
    out.textContent = res.status === 401 ? 'Wrong console key.' : res.status === 503 ? 'SESSION_IMPORT_SECRET is not set on the server.' : 'Failed: ' + (body.error || res.status);
  }
  document.getElementById('open').onsubmit = (e) => { e.preventDefault(); openHere(); };
  // A bookmarked #key= link opens the console straight away.
  if (fromHash) openHere();

  document.getElementById('slack').onclick = async () => {
    out.textContent = 'Opening the server browser…';
    const res = await fetch('/api/session/console/request', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    out.textContent = res.ok ? 'Link posted to Slack. It expires at ' + new Date(body.expiresAt).toLocaleTimeString() + '.' : 'Failed: ' + (body.error || res.status);
  };
</script>
</body>
</html>`;
}

export function renderConsolePage(token: string): string {
  const base = `/api/session/console/${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="referrer" content="no-referrer">
<title>ppomppu login console</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f5; --fg: #1a1a1a; --muted: #666; --accent: #e65100; --panel: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #eee; --muted: #aaa; --panel: #1e1e1e; } }
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 440px; margin: 0 auto; padding: 12px 16px 24px; }
  #status { padding: 8px 10px; border-radius: 6px; background: var(--panel); margin-bottom: 10px; }
  #status.ok { border-left: 4px solid #2e7d32; } #status.warn { border-left: 4px solid var(--accent); }
  #screen { width: 100%; display: block; border: 1px solid #8884; border-radius: 6px; background: #fff; touch-action: manipulation; }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  input[type=text] { flex: 1; min-width: 0; padding: 10px; font-size: 16px; border-radius: 6px; border: 1px solid #8886; background: var(--panel); color: var(--fg); }
  button { padding: 10px 12px; font-size: 15px; border-radius: 6px; border: 1px solid #8886; background: var(--panel); color: var(--fg); }
  p.hint { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<main>
  <div id="status">Connecting…</div>
  <img id="screen" alt="Server browser">
  <div class="row">
    <input id="text" type="text" autocomplete="off" autocapitalize="off" placeholder="Type into the focused field">
    <button id="send">Send</button>
  </div>
  <div class="row">
    <button data-key="Enter">Enter</button>
    <button data-key="Backspace">⌫</button>
    <button data-key="Tab">Tab</button>
    <button id="reload">Reload form</button>
  </div>
  <p class="hint">ID and password are already filled in. Tap the security check (보안 확인), then 로그인. The session is saved automatically.</p>
</main>
<script>
  const base = ${JSON.stringify(base)};
  const screen = document.getElementById('screen');
  const status = document.getElementById('status');
  const labels = { starting: 'Starting the server browser…', ready: 'Ready: tap the security check, then 로그인.', succeeded: 'Done.', failed: 'Failed.', expired: 'Expired.', closed: 'Closed.' };
  function show(state, detail) {
    status.textContent = labels[state] + (detail ? ' ' + detail : '');
    status.className = state === 'succeeded' ? 'ok' : (detail || state !== 'ready') ? 'warn' : '';
  }
  async function send(input) {
    const res = await fetch(base + '/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res.ok) show('closed', '(' + res.status + ')');
  }
  const events = new EventSource(base + '/events');
  events.addEventListener('frame', (e) => { screen.src = 'data:image/jpeg;base64,' + e.data; });
  events.addEventListener('state', (e) => { const s = JSON.parse(e.data); show(s.state, s.detail); if (!['starting', 'ready'].includes(s.state)) events.close(); });
  events.onerror = () => show('closed', 'Connection lost.');
  screen.addEventListener('click', (e) => {
    const r = screen.getBoundingClientRect();
    send({ type: 'click', x: Math.round((e.clientX - r.left) * screen.naturalWidth / r.width), y: Math.round((e.clientY - r.top) * screen.naturalHeight / r.height) });
  });
  document.getElementById('send').onclick = () => { const t = document.getElementById('text'); if (t.value) { send({ type: 'text', text: t.value }); t.value = ''; } };
  document.querySelectorAll('[data-key]').forEach((b) => { b.onclick = () => send({ type: 'key', key: b.dataset.key }); });
  document.getElementById('reload').onclick = () => send({ type: 'reload' });
</script>
</body>
</html>`;
}
