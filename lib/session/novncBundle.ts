/**
 * lib/session/novncBundle.ts
 *
 * The noVNC client as one browser ES module. The npm package ships CommonJS
 * only, so it is bundled: the Docker build writes dist/novnc/rfb.js from
 * NOVNC_ENTRY; in development, where that file is usually absent, esbuild
 * (a dev dependency) bundles it on first request.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ENV } from '../../config/env.js';
import { logger } from '../logging/index.js';

/** Keep in sync with the esbuild step in the Dockerfile. */
export const NOVNC_ENTRY = "export { default } from '@novnc/novnc/lib/rfb.js';";
const BUNDLE_PATH = path.join(ENV.PROJECT_ROOT, 'dist', 'novnc', 'rfb.js');

let bundle: Promise<string | null> | null = null;

export function loadNovncBundle(): Promise<string | null> {
  bundle ??= build();
  return bundle;
}

async function build(): Promise<string | null> {
  if (fs.existsSync(BUNDLE_PATH)) return fs.readFileSync(BUNDLE_PATH, 'utf-8');
  try {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      stdin: { contents: NOVNC_ENTRY, resolveDir: ENV.PROJECT_ROOT },
      bundle: true,
      format: 'esm',
      minify: true,
      write: false,
    });
    return result.outputFiles[0].text;
  } catch (err) {
    logger.warn({ err }, '[LoginConsole] noVNC bundle unavailable: dist/novnc/rfb.js missing and esbuild not installed');
    return null;
  }
}
