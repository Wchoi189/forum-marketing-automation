import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright';

import { ENV } from '../../config/env.js';
import { logger } from '../logger.js';

/**
 * Timestamp-based per-run directory for readable artifact chronology.
 * Allocated when step screenshots or Playwright tracing may write under `publisher-runs/<ts>/`
 * (traces may be discarded on success when sampling skips persistence; the dir still holds optional screenshots).
 */
export function publisherArtifactDirForRun(): string | null {
  if (!ENV.PUBLISHER_DEBUG_SCREENSHOTS && !ENV.PUBLISHER_DEBUG_TRACE) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ENV.PROJECT_ROOT, 'artifacts', 'publisher-runs', timestamp);
}

export async function publisherDebugScreenshot(page: Page, runDir: string | null, label: string): Promise<void> {
  if (!runDir || !ENV.PUBLISHER_DEBUG_SCREENSHOTS) return;
  await fs.mkdir(runDir, { recursive: true });
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_');
  const file = path.join(runDir, `${safe}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => null);
  logger.info({ file, label }, '[Publisher] debug screenshot');
}

/** Always written on publisher failure (when a page exists), even if step screenshots are off. */
export async function publisherFailureScreenshot(page: Page | null, preferredDir: string | null): Promise<void> {
  if (!page) return;
  const dir =
    preferredDir ??
    path.join(ENV.PROJECT_ROOT, 'artifacts', 'publisher-runs', 'failures', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'error.png');
  await page.screenshot({ path: file, fullPage: true }).catch(() => null);
  logger.warn({ file }, '[Publisher] failure screenshot');
}
