/**
 * Integration tests for POST /api/session/import.
 *
 * The probe is stubbed through createApp's probeSession option, so no browser
 * launches and nothing reaches ppomppu. SESSION_IMPORT_SECRET is set to
 * "test-session-secret" by scripts/run-tests.sh.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import type { Cookie } from "playwright";
import { createApp } from "../../server.ts";
import { STORAGE_STATE_PATH } from "../../lib/browser/index.ts";
import { setPublisherRunning } from "../../lib/publisher/index.ts";
import type { SessionProbeResult } from "../../lib/observer/index.ts";

const AUTH = "Bearer test-session-secret";

type BotDeps = NonNullable<Parameters<typeof createApp>[0]>;
const deps = { getLogs: async () => [] } as unknown as BotDeps;

const cookie = (name: string, value: string, domain = ".ppomppu.co.kr") => ({
  name, value, domain, path: "/", session: true, httpOnly: true, secure: true, sameSite: "lax",
});

async function withServer(
  probe: (cookies: Cookie[]) => Promise<SessionProbeResult>,
  fn: (url: string) => Promise<void>,
) {
  const server = createApp(deps, undefined, { probeSession: probe }).listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/session/import`);
  } finally {
    server.close();
  }
}

const post = (url: string, body: unknown, auth = AUTH) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth }, body: JSON.stringify(body) });

function writeState(cookies: ReturnType<typeof cookie>[]) {
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify({ cookies: cookies.map((c) => ({ ...c, expires: -1, sameSite: "Lax" })) }));
}

const savedCookies = () => JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, "utf-8")).cookies as Cookie[];
const loggedIn = async (): Promise<SessionProbeResult> => ({ sessionState: "logged_in", url: "board" });

test("session import: rejects a wrong or missing bearer token", async () => {
  await withServer(loggedIn, async (url) => {
    assert.equal((await post(url, { cookies: [] }, "Bearer wrong")).status, 401);
    assert.equal((await post(url, { cookies: [] }, "")).status, 401);
  });
});

test("session import: 400 without a login cookie", async () => {
  await withServer(loggedIn, async (url) => {
    const res = await post(url, { cookies: [cookie("_ga", "x")] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "no_session_cookie");
  });
});

test("session import: 409 while a publisher run is active", async () => {
  setPublisherRunning(true);
  try {
    await withServer(loggedIn, async (url) => {
      assert.equal((await post(url, { cookies: [cookie("PHPSESSID", "new")] })).status, 409);
    });
  } finally {
    setPublisherRunning(false);
  }
});

test("session import: a logged-out probe leaves the saved state untouched", async () => {
  writeState([cookie("PHPSESSID", "old"), cookie("cf_clearance", "server")]);
  const before = fs.readFileSync(STORAGE_STATE_PATH, "utf-8");
  await withServer(async () => ({ sessionState: "logged_out", url: "board" }), async (url) => {
    const res = await post(url, { cookies: [cookie("PHPSESSID", "dead")] });
    assert.equal(res.status, 422);
  });
  assert.equal(fs.readFileSync(STORAGE_STATE_PATH, "utf-8"), before);
});

test("session import: verified cookies are merged, trackers dropped, server cf_clearance kept", async () => {
  writeState([cookie("PHPSESSID", "old"), cookie("cf_clearance", "server"), cookie("m_gad_pos_1", "ad")]);
  let probed: Cookie[] = [];
  await withServer(async (cookies) => { probed = cookies; return loggedIn(); }, async (url) => {
    const res = await post(url, {
      source: "test",
      cookies: [cookie("PHPSESSID", "new"), cookie("pmn", "p"), cookie("cf_clearance", "laptop"), cookie("__gads", "ad"), cookie("IDE", "x", ".doubleclick.net")],
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "imported");
  });

  const byName = Object.fromEntries(savedCookies().map((c) => [c.name, c.value]));
  assert.deepEqual(byName, { PHPSESSID: "new", cf_clearance: "server", pmn: "p" });
  assert.deepEqual(probed.map((c) => c.name).sort(), ["PHPSESSID", "cf_clearance", "pmn"]);
  assert.ok(fs.existsSync(`${STORAGE_STATE_PATH}.bak`));
});

test("session import: an unchanged session skips the probe", async () => {
  writeState([cookie("PHPSESSID", "same"), cookie("pmn", "p")]);
  let probeCalls = 0;
  await withServer(async () => { probeCalls++; return loggedIn(); }, async (url) => {
    const res = await post(url, { cookies: [cookie("PHPSESSID", "same"), cookie("pmn", "p"), cookie("main_login_tab", "2", "www.ppomppu.co.kr")] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "unchanged");
  });
  assert.equal(probeCalls, 0);
});
