/**
 * PlaywrightCrawler factory for competitor intelligence.
 *
 * Key config: high requestHandlerTimeoutSecs (300s) for OCR/VLM,
 * concurrency and rate limiting tuned to avoid overloading targets.
 */

import { PlaywrightCrawler, type RequestQueue } from "crawlee";
import type { PlaywrightCrawlingContext } from "crawlee";
import { ENV } from "../../../config/env.js";

export type CrawlerOptions = {
  maxConcurrency?: number;
  maxRequestsPerMinute?: number;
  maxRetries?: number;
  headless?: boolean;
  requestHandlerTimeoutSecs?: number;
  requestQueue?: RequestQueue;
};

export function createPlaywrightCrawler(
  requestHandler: (context: PlaywrightCrawlingContext) => Promise<void>,
  opts: CrawlerOptions = {},
): PlaywrightCrawler {
  const {
    maxConcurrency = 1,
    maxRequestsPerMinute = 60,
    maxRetries = 2,
    headless = ENV.BROWSER_HEADLESS ?? true,
    requestHandlerTimeoutSecs = 300,
    requestQueue,
  } = opts;

  return new PlaywrightCrawler({
    requestHandler,
    requestQueue,
    maxConcurrency,
    maxRequestsPerMinute,
    maxRequestRetries: maxRetries,
    requestHandlerTimeoutSecs,
    headless,
    launchContext: {
      launchOptions: {
        headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      },
    },
  });
}
