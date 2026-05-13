import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from '../lib/playwright/browser-eval-polyfill.js';

const DEFAULT_MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 10;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type ManagedSession = {
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
  createdAt: number;
};

export type ResolvePageInput = {
  sessionId?: string;
  url?: string;
};

export type ResolvedPage = {
  page: Page;
  sessionId?: string;
  release: () => Promise<void>;
};

export type ParserSessionManagerConfig = {
  headless: boolean;
  timeoutMs: number;
  maxSessionAgeMs?: number;
  maxSessions?: number;
};

export class ParserSessionManager {
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private readonly maxSessionAgeMs: number;
  private readonly maxSessions: number;
  private browserPromise: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(config: ParserSessionManagerConfig);
  constructor(headless: boolean, timeoutMs: number);
  constructor(arg1: ParserSessionManagerConfig | boolean, arg2?: number) {
    if (typeof arg1 === 'boolean') {
      this.headless = arg1;
      this.timeoutMs = Math.max(5000, Math.min(arg2 ?? 45000, 120000));
      this.maxSessionAgeMs = DEFAULT_MAX_SESSION_AGE_MS;
      this.maxSessions = DEFAULT_MAX_SESSIONS;
    } else {
      this.headless = arg1.headless;
      this.timeoutMs = Math.max(5000, Math.min(arg1.timeoutMs, 120000));
      this.maxSessionAgeMs = arg1.maxSessionAgeMs ?? DEFAULT_MAX_SESSION_AGE_MS;
      this.maxSessions = arg1.maxSessions ?? DEFAULT_MAX_SESSIONS;
    }
    this.cleanupTimer = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt >= this.maxSessionAgeMs) {
        void session.context.close().catch(() => {});
        this.sessions.delete(id);
      }
    }
  }

  private evictOldest(): void {
    if (this.sessions.size < this.maxSessions) return;
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of this.sessions.entries()) {
      if (session.lastUsedAt < oldestTime) {
        oldestTime = session.lastUsedAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      void this.sessions.get(oldestId)!.context.close().catch(() => {});
      this.sessions.delete(oldestId);
    }
  }

  private async createContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    await context.addInitScript({ content: BROWSER_EVAL_NAME_POLYFILL_SCRIPT });
    return context;
  }

  async resolvePage(input: ResolvePageInput): Promise<ResolvedPage> {
    if (this.closed) {
      throw new Error('Session manager has been closed');
    }

    this.evictExpired();

    if (input.sessionId) {
      const existing = this.sessions.get(input.sessionId);
      if (existing) {
        await this.preparePage(existing.page, input.url);
        existing.lastUsedAt = Date.now();
        return {
          page: existing.page,
          sessionId: input.sessionId,
          release: async () => {
            existing.lastUsedAt = Date.now();
          }
        };
      }
      // Session doesn't exist (never created or was evicted) — create one with this ID
      if (this.sessions.size >= this.maxSessions) {
        this.evictOldest();
      }
      const context = await this.createContext();
      const page = await context.newPage();
      const session: ManagedSession = {
        context,
        page,
        lastUsedAt: Date.now(),
        createdAt: Date.now()
      };
      this.sessions.set(input.sessionId, session);
      await this.preparePage(page, input.url);
      return {
        page,
        sessionId: input.sessionId,
        release: async () => {
          session.lastUsedAt = Date.now();
        }
      };
    }

    while (this.sessions.size >= this.maxSessions) {
      this.evictOldest();
    }

    const context = await this.createContext();
    const page = await context.newPage();
    await this.preparePage(page, input.url);
    return {
      page,
      release: async () => {
        await context.close();
      }
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      await session.context.close();
    }
    this.sessions.clear();
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
    }
    this.browserPromise = null;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: this.headless });
    }
    return this.browserPromise;
  }

  private async preparePage(page: Page, url?: string): Promise<void> {
    if (!url) return;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
  }
}
