import fs from "node:fs/promises";
import path from "node:path";
import type { PublisherHistoryEntry } from "../contracts/models.js";

type FixtureSpec = {
  id: string;
  description: string;
  entries: PublisherHistoryEntry[];
};

function atOffset(baseMs: number, minuteOffset: number): string {
  return new Date(baseMs + minuteOffset * 60 * 1000).toISOString();
}

function buildRecheckHeavyFixture(baseMs: number): FixtureSpec {
  const entries: PublisherHistoryEntry[] = [];
  for (let i = 0; i < 24; i += 1) {
    const isOpportunity = i % 7 === 3 || i % 7 === 4;
    entries.push({
      at: atOffset(baseMs, i * 3),
      success: isOpportunity,
      force: false,
      message: isOpportunity ? "Publication submitted successfully" : "Gap policy skip",
      decision: isOpportunity ? "published_verified" : "gap_policy",
      runId: `fixture-recheck-heavy-${i + 1}`,
      artifactDir: isOpportunity ? `artifacts/publisher-runs/fixture-recheck-heavy-${i + 1}` : null,
    });
  }
  return {
    id: "fixture-recheck-heavy",
    description:
      "High frequency gap-policy skips with sparse successful opportunities. Isolated adaptation should stay stable and avoid skip-driven inflation.",
    entries,
  };
}

function buildOpportunityShiftFixture(baseMs: number): FixtureSpec {
  const entries: PublisherHistoryEntry[] = [];
  for (let i = 0; i < 24; i += 1) {
    let decision: PublisherHistoryEntry["decision"] = "published_verified";
    let success = true;
    if (i >= 12 && i <= 18) {
      decision = "publisher_error";
      success = false;
    } else if (i % 10 === 0) {
      decision = "gap_policy";
      success = false;
    } else if (i % 8 === 0) {
      decision = "dry_run";
      success = true;
    }

    entries.push({
      at: atOffset(baseMs, i * 5),
      success,
      force: false,
      message: success ? "Opportunity captured" : "Opportunity failed",
      decision,
      runId: `fixture-opportunity-shift-${i + 1}`,
      artifactDir: decision === "gap_policy" ? null : `artifacts/publisher-runs/fixture-opportunity-shift-${i + 1}`,
    });
  }
  return {
    id: "fixture-opportunity-shift",
    description:
      "Stable cadence with a mid-window quality drop (publisher_error burst) to verify isolated adaptation follows opportunity outcomes.",
    entries,
  };
}

async function main(): Promise<void> {
  const outputDir = path.join("tests", "fixtures", "scheduler-signals");
  await fs.mkdir(outputDir, { recursive: true });

  const baseMs = Date.parse("2026-04-01T00:00:00.000Z");
  const fixtures: FixtureSpec[] = [
    buildRecheckHeavyFixture(baseMs),
    buildOpportunityShiftFixture(baseMs + 2 * 24 * 60 * 60 * 1000),
  ];

  for (const fixture of fixtures) {
    const payload = {
      id: fixture.id,
      description: fixture.description,
      generatedAt: new Date().toISOString(),
      entries: fixture.entries,
    };
    const filePath = path.join(outputDir, `${fixture.id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outputDir,
        fixtureIds: fixtures.map((fixture) => fixture.id),
      },
      null,
      2
    )}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`generate_scheduler_signal_fixtures failed: ${String(err)}\n`);
  process.exitCode = 1;
});
