import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

type ManagedSession = {
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
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

export class ParserSessionManager {
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private browserPromise: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(headless: boolean, timeoutMs: number) {
    this.headless = headless;
    this.timeoutMs = Math.max(5000, Math.min(timeoutMs, 120000));
  }

  private async createContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || ((fn, _name) => fn);'
    });
    return context;
  }

  async resolvePage(input: ResolvePageInput): Promise<ResolvedPage> {
    if (input.sessionId) {
      const session = await this.getOrCreateManagedSession(input.sessionId);
      await this.preparePage(session.page, input.url);
      session.lastUsedAt = Date.now();
      return {
        page: session.page,
        sessionId: input.sessionId,
        release: async () => {
          session.lastUsedAt = Date.now();
        }
      };
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

  private async getOrCreateManagedSession(sessionId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const context = await this.createContext();
    const page = await context.newPage();
    const created: ManagedSession = {
      context,
      page,
      lastUsedAt: Date.now()
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private async preparePage(page: Page, url?: string): Promise<void> {
    if (!url) return;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
  }
}
