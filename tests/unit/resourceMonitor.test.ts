/**
 * Guards the blast radius of garbage collection.
 *
 * GC operates on artifacts/publisher-runs/ only. Everything else under
 * ARTIFACTS_DIR is durable: competitor-ads/ holds the intel SQLite database,
 * kakao-history/ holds ingested chat records, and the loose JSON files hold
 * persisted runtime state. A regression that widens the scope to all of
 * ARTIFACTS_DIR would silently delete them on the next production tick.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ENV } from '../../config/env.js';

const ARTIFACTS = ENV.ARTIFACTS_DIR;
const PUBLISHER_RUNS = path.join(ARTIFACTS, 'publisher-runs');

/** Backdate a path well beyond MAX_ARTIFACT_AGE_DAYS so GC considers it stale. */
function backdate(target: string, days = 90): void {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  fs.utimesSync(target, when, when);
}

test('rotateArtifacts deletes stale publisher runs but spares durable artifacts', async () => {
  const { rotateArtifacts } = await import('../../lib/resourceMonitor.js');

  const staleRun = path.join(PUBLISHER_RUNS, 'run-stale-fixture');
  const freshRun = path.join(PUBLISHER_RUNS, 'run-fresh-fixture');
  const durableDirs = ['competitor-ads', 'kakao-history', 'board-diagnostics', 'scheduler-replay', 'screenshots'];
  const durableFile = path.join(ARTIFACTS, 'publisher-history.json');

  fs.mkdirSync(staleRun, { recursive: true });
  fs.mkdirSync(freshRun, { recursive: true });
  fs.writeFileSync(path.join(staleRun, 'screenshot.txt'), 'stale');
  fs.writeFileSync(path.join(freshRun, 'screenshot.txt'), 'fresh');
  backdate(staleRun);

  for (const name of durableDirs) {
    const dir = path.join(ARTIFACTS, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keepme.txt'), name);
    backdate(dir);
  }
  fs.writeFileSync(durableFile, '[]');
  backdate(durableFile);

  const result = await rotateArtifacts();

  assert.equal(fs.existsSync(staleRun), false, 'stale publisher run should be deleted');
  assert.equal(fs.existsSync(freshRun), true, 'fresh publisher run should survive');
  assert.ok(result.deletedCount >= 1, 'rotation should report at least one deletion');

  for (const name of durableDirs) {
    assert.equal(
      fs.existsSync(path.join(ARTIFACTS, name, 'keepme.txt')),
      true,
      `durable artifacts/${name} must survive GC`
    );
  }
  assert.equal(fs.existsSync(durableFile), true, 'publisher-history.json must survive GC');
});

test('capArtifactsBySize never reaches outside publisher-runs', async () => {
  const { capArtifactsBySize } = await import('../../lib/resourceMonitor.js');

  const durable = path.join(ARTIFACTS, 'competitor-ads');
  fs.mkdirSync(durable, { recursive: true });
  fs.writeFileSync(path.join(durable, 'competitor-ads.db'), 'x'.repeat(1024));
  backdate(durable, 365);

  // A 0 MB cap is the most aggressive setting possible: if the cap could see
  // durable directories at all, it would delete this one first (oldest mtime).
  await capArtifactsBySize(0);

  assert.equal(
    fs.existsSync(path.join(durable, 'competitor-ads.db')),
    true,
    'size cap must not delete the competitor intel database'
  );
});
