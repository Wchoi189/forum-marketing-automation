import test from 'node:test';
import assert from 'node:assert/strict';
import { ParserSessionManager } from '../../mcp/parser-session.js';

function dataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const simplePage = dataUrl('<html><body><h1>Hello</h1></body></html>');

test('ParserSessionManager: constructor backward compatibility', async (t) => {
  const mgr = new ParserSessionManager(true, 15000);
  assert.ok(mgr, 'Should accept boolean+number constructor args');
  await mgr.close();
});

test('ParserSessionManager: config object constructor', async (t) => {
  const mgr = new ParserSessionManager({
    headless: true,
    timeoutMs: 15000,
    maxSessionAgeMs: 60000,
    maxSessions: 5
  });
  assert.ok(mgr, 'Should accept config object');
  await mgr.close();
});

test('ParserSessionManager: non-session resolve creates and closes context', async (t) => {
  const mgr = new ParserSessionManager(true, 15000);
  try {
    const resolved = await mgr.resolvePage({ url: simplePage });
    assert.ok(resolved.page, 'Should return a page');
    assert.equal(resolved.sessionId, undefined, 'Should not have a session ID');
    await resolved.release();
  } finally {
    await mgr.close();
  }
});

test('ParserSessionManager: session reuse by ID', async (t) => {
  const mgr = new ParserSessionManager(true, 15000);
  try {
    const resolved1 = await mgr.resolvePage({ sessionId: 's1', url: simplePage });
    assert.equal(resolved1.sessionId, 's1');
    const page1 = resolved1.page;

    const resolved2 = await mgr.resolvePage({ sessionId: 's1', url: undefined });
    assert.equal(resolved2.sessionId, 's1');
    assert.equal(resolved2.page, page1, 'Should reuse the same page');

    await resolved1.release();
    await resolved2.release();
  } finally {
    await mgr.close();
  }
});

test('ParserSessionManager: TTL eviction creates new session for evicted ID', async (t) => {
  const mgr = new ParserSessionManager({
    headless: true,
    timeoutMs: 15000,
    maxSessionAgeMs: 100, // 100ms TTL
    maxSessions: 10
  });
  try {
    const resolved = await mgr.resolvePage({ sessionId: 'ttl-test', url: simplePage });
    const pageRef = resolved.page;
    await resolved.release();

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    // Session should be evicted — requesting same ID creates a fresh session
    const resolved2 = await mgr.resolvePage({ sessionId: 'ttl-test', url: simplePage });
    assert.notEqual(resolved2.page, pageRef, 'Should have created a new page after TTL eviction');
    await resolved2.release();
  } finally {
    await mgr.close();
  }
});

test('ParserSessionManager: capacity eviction — oldest session removed', async (t) => {
  const mgr = new ParserSessionManager({
    headless: true,
    timeoutMs: 15000,
    maxSessionAgeMs: 60000,
    maxSessions: 2
  });
  try {
    // Create session 'a'
    const r1 = await mgr.resolvePage({ sessionId: 'a', url: simplePage });
    const pageA = r1.page;
    await r1.release();

    // Create session 'b'
    const r2 = await mgr.resolvePage({ sessionId: 'b', url: simplePage });
    await r2.release();

    // Create session 'c' — should evict 'a' (maxSessions=2)
    const r3 = await mgr.resolvePage({ sessionId: 'c', url: simplePage });
    await r3.release();

    // Session 'a' was evicted — requesting same ID creates a NEW session
    const r4 = await mgr.resolvePage({ sessionId: 'a', url: simplePage });
    assert.notEqual(r4.page, pageA, 'Should have created a new page after capacity eviction of a');
    await r4.release();

    // Session 'c' should still be present (same page object, not evicted yet)
    const rc = await mgr.resolvePage({ sessionId: 'c', url: simplePage });
    assert.equal(rc.page, r3.page, 'Session c should still be the original page');
    await rc.release();
  } finally {
    await mgr.close();
  }
});

test('ParserSessionManager: close rejects further requests', async (t) => {
  const mgr = new ParserSessionManager({
    headless: true,
    timeoutMs: 15000,
    maxSessionAgeMs: 60000,
    maxSessions: 5
  });

  const r1 = await mgr.resolvePage({ sessionId: 'x', url: simplePage });
  await r1.release();

  await mgr.close();

  // After close, resolvePage should throw
  await assert.rejects(
    () => mgr.resolvePage({ sessionId: 'y', url: simplePage }),
    /closed/
  );
});
