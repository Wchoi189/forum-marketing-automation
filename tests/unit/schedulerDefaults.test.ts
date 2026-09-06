/**
 * tests/unit/schedulerDefaults.test.ts
 *
 * R2 / SDU-006 — regression guard for the default-set divergence.
 *
 * Four literal default sets used to exist and had drifted apart on eight fields
 * (see .planning/.../r2-resolution-log.md). These tests fail if a consumer stops
 * reading the single source, or if a second literal set reappears in the tree.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SCHEDULER_CONTROLS,
  defaultAutoPublisherControls,
  PRESET_CONFIG,
  startScheduler,
} from "../../lib/scheduler/index.js";
import type { BotDeps } from "../../lib/scheduler/index.js";
import { DEFAULT_SCHEDULER_CONTROLS as STATE_DEFAULT_SCHEDULER_CONTROLS } from "../../lib/state/index.js";
import { ENV } from "../../config/env.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Every consumer reads the one object
// ---------------------------------------------------------------------------

test("lib/state re-exports the very same object as lib/scheduler, not a copy", () => {
  assert.strictEqual(
    STATE_DEFAULT_SCHEDULER_CONTROLS,
    DEFAULT_SCHEDULER_CONTROLS,
    "lib/state/scheduler.ts must re-export the single source, not declare its own"
  );
});

test("defaultAutoPublisherControls is the default set minus the preset name", () => {
  const { preset, ...controls } = DEFAULT_SCHEDULER_CONTROLS;
  assert.strictEqual(preset, "balanced");
  assert.deepStrictEqual(defaultAutoPublisherControls(), controls);
});

test("env-derived defaults stay env-derived", () => {
  assert.strictEqual(DEFAULT_SCHEDULER_CONTROLS.baseIntervalMinutes, ENV.RUN_INTERVAL_MINUTES);
  assert.strictEqual(DEFAULT_SCHEDULER_CONTROLS.scheduleJitterPercent, ENV.SCHEDULER_JITTER_PERCENT);
  assert.strictEqual(DEFAULT_SCHEDULER_CONTROLS.scheduleJitterMode, ENV.SCHEDULER_JITTER_MODE);
});

test("the balanced preset is the default set, so selecting it is a no-op", () => {
  const { enabled, ...pacing } = defaultAutoPublisherControls();
  assert.deepStrictEqual(PRESET_CONFIG.balanced.autoPublisher, pacing);
});

test("every preset declares every pacing field, so switching inherits nothing", () => {
  const expectedFields = Object.keys(defaultAutoPublisherControls())
    .filter((field) => field !== "enabled")
    .sort();

  for (const [name, config] of Object.entries(PRESET_CONFIG)) {
    assert.deepStrictEqual(
      Object.keys(config.autoPublisher).sort(),
      expectedFields,
      `preset ${name} does not declare exactly the pacing fields`
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(config.autoPublisher, "enabled"),
      `preset ${name} must not carry the operator kill-switch`
    );
  }
});

test("a scheduler started with no persisted state reports the default set", async () => {
  const deps: BotDeps = {
    runObserver: async () => {
      throw new Error("not called");
    },
    runPublisher: async () => {
      throw new Error("not called");
    },
    getLogs: async () => [],
    getPublisherHistory: async () => [],
  };

  const scheduler = startScheduler(deps);
  try {
    const state = await scheduler.getState();
    const defaults = defaultAutoPublisherControls();
    for (const [field, value] of Object.entries(defaults)) {
      assert.strictEqual(
        (state as Record<string, unknown>)[field],
        value,
        `startScheduler diverged from the default set on ${field}`
      );
    }
  } finally {
    scheduler.stop();
  }
});

// ---------------------------------------------------------------------------
// No second literal default set anywhere in the tree
// ---------------------------------------------------------------------------

/**
 * A "default set" is an object literal that fixes both the base interval and the gap
 * recheck interval to constants. Overrides (presets) and merges (normalize, the
 * startScheduler fallback chain) compute their values, so they do not match.
 *
 * tests/ is excluded: fixtures legitimately build whole control objects.
 *
 * src/lib/controlPanel.ts is allowed a literal because it is browser code: importing
 * config/env.ts to reach the single source would pull server env parsing into the
 * bundle. Its values are pinned instead by the test below it.
 */
const LITERAL_DEFAULT_SET_ALLOWLIST = ["lib/scheduler/defaults.ts", "src/lib/controlPanel.ts"];

test("only the allowlisted files declare a literal scheduler default set", () => {
  // --others --exclude-standard so a newly added, not-yet-committed default set is
  // caught by the guard rather than sailing past it.
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("tests/"));
  assert.ok(tracked.includes("lib/scheduler/defaults.ts"), "the file listing did not reach lib/");

  const literalBaseInterval = /baseIntervalMinutes:\s*(?:\d+|ENV\.[A-Z_]+)\s*,/;
  const offenders = tracked.filter((file) => {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    return literalBaseInterval.test(source) && /gapRecheckIntervalMinutes:/.test(source);
  });

  assert.deepStrictEqual(
    offenders.sort(),
    [...LITERAL_DEFAULT_SET_ALLOWLIST].sort(),
    `a second literal scheduler default set appeared. Import DEFAULT_SCHEDULER_CONTROLS from lib/scheduler instead.\nFound: ${offenders.join(", ")}`
  );
});

test("the frontend placeholder state matches the reconciled server defaults", () => {
  const defaults = defaultAutoPublisherControls();
  const source = readFileSync(path.join(REPO_ROOT, "src/lib/controlPanel.ts"), "utf8");

  // The one field the browser cannot derive is the env-configured base interval, so it
  // is compared against the env default rather than the running value.
  const expected: Record<string, string> = {
    enabled: "true",
    quietHoursStart: "3",
    quietHoursEnd: "5",
    quietHoursMultiplier: "1.8",
    activeHoursStart: "8",
    activeHoursEnd: "23",
    activeHoursMultiplier: "0.8",
    trendAdaptiveEnabled: "true",
    trendWindowDays: "7",
    trendRecalibrationDays: "7",
    targetPublishIntervalMinutes: "0",
    gapRecheckIntervalMinutes: "3",
    scheduleJitterMode: "'uniform'",
  };

  for (const [field, literal] of Object.entries(expected)) {
    assert.ok(
      new RegExp(`${field}:\\s*${literal.replace(/[.*+?^$()|[\\\]{}]/g, "\\$&")}\\s*,`).test(source),
      `src/lib/controlPanel.ts drifted from the reconciled default for ${field} (expected ${literal})`
    );
    // And the server default it mirrors must still hold that value.
    assert.strictEqual(
      String((defaults as Record<string, unknown>)[field]).replace(/^uniform$/, "'uniform'"),
      literal,
      `the server default for ${field} moved; update src/lib/controlPanel.ts to match`
    );
  }
});
