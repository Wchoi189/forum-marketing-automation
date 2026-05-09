You’re basically building a “competitive intelligence crawler” for community forums with a strong focus on structured extraction and evidence tracking. In the JS/TS ecosystem there are a few close “out of the box” candidates worth considering, but nothing that will replace your whole script 1:1; instead they can replace large chunks (crawling, storage, and LLM extraction) so your custom logic shrinks a lot. [firecrawl]

Below I’ll:
1) Put a name on what you’ve built (so you can search better),
2) Point to concrete open‑source tools that are the closest match, and
3) Suggest a realistic “swap‑in” architecture where you keep only the parts that are really bespoke.

***

## What to call what you’re building

Good search terms / framing for what this script does:

- “LLM‑powered web crawler for competitive intelligence”
- “Playwright crawler with structured extraction”
- “Forum scraping for competitor analysis”
- “JavaScript web scraping framework Crawlee / PlaywrightCrawler”

Those terms line up with how modern open‑source projects describe this space: web crawlers with LLM‑ready output for competitive intelligence, RAG, and agents. [data4ai]

***

## Off‑the‑shelf building blocks

### 1) Crawling + concurrency + rate limiting

You’re manually doing:

- URL list ingestion from CSV
- Per‑URL Playwright sessions with retry, backoff, and rate limiting
- Record writing + deduplication
- Simple “dataset” management via JSONL.gz

In Node/TS, the natural out‑of‑the‑box replacement is **Crawlee** (from Apify). It already wraps Playwright and Puppeteer, handles queues, autoscaling, retries, and rate limiting, and outputs datasets as JSON with an idiomatic API.

Example from Crawlee docs (PlaywrightCrawler): [github](https://github.com/apify/crawlee)

```ts
import { PlaywrightCrawler, Dataset } from 'crawlee';

const crawler = new PlaywrightCrawler({
  async requestHandler({ request, page, enqueueLinks, log }) {
    const title = await page.title();
    log.info(`Title of ${request.loadedUrl} is '${title}'`);
    await Dataset.pushData({ title, url: request.loadedUrl });
    await enqueueLinks();
  },
});

await crawler.run(['https://crawlee.dev']);
```

What Crawlee can replace for you:

- `processPostWithRetry`, `processPostIsolated` boilerplate around Playwright
- Your manual rate limiting (`rateLimitRps`, `sleep` + jitter)
- Parts of your artifact path and dataset handling (it has its own storage abstraction)

You’d still plug in:

- Your `parsePpomppuPost` logic inside `requestHandler`
- Your OCR/VLM pipeline inside `requestHandler` for pages where HTML parse is low‑confidence

If you want to keep using plain Playwright, **Firecrawl’s Node SDK** can also act as a higher‑level crawler that outputs LLM‑ready markdown/HTML and can be asked to run structured extraction, but it’s more opinionated and currently stronger in Python; it’s designed as an “LLM‑ready crawler” for RAG/agents. [firecrawl]

***

### 2) “LLM‑ready” extraction frameworks

You’re already part‑way to a structured‑extraction pipeline using:

- Deterministic HTML parsing (`parsePpomppuPost`, `subtree`)
- Fallback OCR and VLM with schema‑constrained JSON output
- Confidence heuristics and validation (e.g., comparing VLM prices with HTML prices)

There are now open‑source crawlers positioned specifically as **LLM‑friendly** with structured extraction hooks:

- **Crawl4AI** (Python) – a trending project marketed as an LLM‑ready web crawler with question‑based crawling and content extraction; integrates with local LLMs (via Ollama, etc.) to do structured extraction during the crawl. [github](https://github.com/unclecode/crawl4ai)
- **Firecrawl** – multi‑language (Python, Node, Go, Rust) crawler that converts pages to clean markdown, handles JS rendering, pagination, and includes “LLM‑powered structured extraction” on‑crawl. [firecrawl]

These tools won’t know your Ppomppu‑specific schema, but they can:

- Handle crawling, JS rendering, pagination, and content cleanup
- Apply LLM prompts to each page to emit structured JSON, often with a schema or “natural language spec” rather than hand‑rolled parsing

So instead of:

- Node TS + Playwright + Ollama + `parsePpomppuPost`

You could:

- Use Firecrawl or Crawl4AI as the crawler,
- Define a JSON extraction schema (“products with name, plan_tier, price_krw…”) in the extraction step,
- Run it against your forum URLs or entire forum sections, and
- Post‑process the JSON into your `CompetitorAdRecord` structure.

This is especially attractive if you ever expand beyond Ppomppu to multiple forums; the LLM schema approach scales better than per‑site deterministic parsers. [github](https://github.com/unclecode/crawl4ai)

***

### 3) JS scraping frameworks you might be reinventing

A quick spectrum in JS/TS land: [scrapehero](https://www.scrapehero.com/open-source-javascript-web-scraping-tools-and-frameworks/)

| Tool       | Layer it replaces in your script                                      |
|-----------|------------------------------------------------------------------------|
| Playwright | You’re already using it; raw browser control only.                    |
| Puppeteer | Alt to Playwright; less relevant since you’re already on Playwright.   |
| **Crawlee** | Adds queueing, retries, autoscaling, datasets, browser pool, rate limit. |
| Firecrawl | Adds full‑site crawling + JS rendering + markdown + LLM extraction.    |

Most of your “framework” work (rate limits, retries, artifact directory management, record deduplication) is covered by Crawlee or Firecrawl. Crawlee is a drop‑in for your existing TS stack; Firecrawl is stronger when you want LLM‑centric crawling and don’t mind adopting its conventions. [data4ai](https://data4ai.com/blog/tool-comparisons/top-open-source-web-scraping-tools/)

***

### 4) OCR and VLM components

Your OCR/VLM pipeline is:

- Local Ollama endpoint
- Manual image filtering (size, dimensions, format checks)
- OCR prompt → text → heuristics on price/duration
- Low‑confidence OCR triggers VLM JSON extraction
- Validation of VLM data vs HTML (`validateVlmAgainstHtml`)

There isn’t (yet) a polished Node‑first library that does all of that out‑of‑the‑box, but there are **model‑level** open‑source OCR/VLM projects you could plug into instead of rolling your own prompts and heuristics:

- GOT‑OCR, OCRFlux, MinerU, etc. for OCR + document understanding, many of which now support batching and integration via serving frameworks like vLLM or MLX‑VLM. [reddit]
In practice, though, the unique thing in your code is not “OCR” itself; it’s the domain‑specific interpretation:

- Korean price patterns (`\d{1,3}(?:,\d{3})+\s*원`)
- Duration in months (`\d{1,2}\s*개월`)
- Product naming heuristics from surrounding context

No generic OCR/VLM stack will do that for you; at most they give you better raw text / structured output. So your code here is more “business logic” than infrastructure, and it’s actually a defensible asset.

***

## How far can you realistically replace this?

### Parts that are strong candidates to replace

- **CLI and runner boilerplate**
  - `parseArgs`, `loadCsvRows`, JSONL gzip writing, run summary file, etc.
  - This can be offloaded to Crawlee’s CLI and Dataset abstraction, or you can drastically simplify it if you let Crawlee manage persistent state and storage. [github](https://github.com/apify/crawlee)

- **Crawler orchestration**
  - `processPostWithRetry`, manual Playwright lifecycle management, `sleep` + jitter, `rateLimitRps` throttle.
  - Strongly covered by Crawlee (PlaywrightCrawler) with autoscaled concurrency, queueing, retries, and per‑domain rate limiting. [data4ai]

- **Generic artifact management**
  - Directories like `raw_html`, `images`, `ocr`, `vlm`, `logs` under `artifacts/competitor-ads/<runId>`.
  - Crawlee and Firecrawl both have built‑in storage; you can still keep evidence (HTML, screenshots) but let the framework structure how/where it’s stored. [firecrawl]

### Parts that are genuinely custom and valuable

- **Ppomppu‑specific deterministic parsing (`parsePpomppuPost`)**
  - You know the DOM structure, what counts as “vendor”, how dates and products are encoded.
  - This is work you’d have to redo in any framework, unless you move fully to LLM‑only extraction.

- **Domain heuristics for ads (prices, durations, KRW formatting)**
  - Regexes for Korean currency and subscription periods.
  - Logic for `products`, derived price per month, constraint fields.

- **Evidence tracking / provenance**
  - `EvidenceSource` typed by `html | ocr | vlm`, `field_evidence`, and explicit linking to images and blocks.
  - This is above and beyond typical web crawlers and matters for trust + audit‑ability of your findings.

- **Hybrid validation (VLM vs HTML)**
  - `validateVlmAgainstHtml` that reconciles VLM numbers with HTML numbers and corrects big deviations.
  - This is very much your IP and not something you’d find in a generic framework.

Given that, I would not throw your script away. I’d wrap your existing *domain logic* inside a higher‑level crawler framework and retire the plumbing you’ve reimplemented.

***

## A pragmatic “swap‑in” architecture

A realistic path that saves you time but keeps your differentiated pieces:

1. **Replace the main loop with Crawlee**
   - Use `PlaywrightCrawler` with concurrency and automatic retries.
   - Each request gets a `page` and `request.userData` where you can pass `vendor`, `notesOverride` from the CSV.

2. **Inside Crawlee’s `requestHandler`**
   - Run your existing `parsePpomppuPost` on `await page.content()`.
   - If confidence high → build record via `buildRecordFromDeterministic`.
   - If low → run your OCR/VLM pipeline on screenshots and images exactly as you already do.

3. **Output records via Crawlee’s Dataset instead of manual JSONL.gz**
   - `await Dataset.pushData(record)` instead of `gzip.write(JSON.stringify(record))`.
   - You can then export or post‑process as needed.

4. (Optional) **Move crawling itself to Firecrawl or Crawl4AI when you want broader coverage**
   - For now, your URLs are from a CSV; later you can point a crawler at forum listing pages and auto‑discover new posts.
   - Then feed discovered URLs into your “Ppomppu parser + OCR/VLM” component.

This lets you keep probably 40–60% of your code (the parts that are hard to buy) and offload the parts that frameworks are better at.

***

## Concrete repos / keywords to search now

If you want direct GitHub things to read / copy from:

- **Crawlee** – “web scraping and browser automation library” (Node/TS). Use it as the main orchestrator instead of your hand‑rolled loop. [scrapehero]
- **Firecrawl** – “all‑in‑one LLM workflows: markdown, JS rendering, structured extraction, fast CLI crawling”. Excellent for LLM‑centric crawling, including support for Ollama‑like local models. [firecrawl]
- **Crawl4AI** – “LLM‑friendly web crawler” with natural‑language driven crawling and content extraction; good reference if you later build a Python component or want to see how others structure LLM extraction pipelines.

These projects use terms like “LLM‑ready web crawler”, “structured extraction”, and “competitive intelligence monitor” which are good anchors for further searching.

***

From your perspective, the big strategic question is: do you want a generic “LLM‑ready crawler” that you configure via schemas/prompts, or a very Ppomppu‑specific, battle‑tested extractor? Given SharePlan sounds niche and Korean‑market specific, you’re actually quite far along on an asset that general tools will not match out‑of‑the‑box.

If you had to pick one layer to replace first (to reduce maintenance burden), would you rather swap out the crawling/orchestration (Playwright + retries + rate limits) or the OCR/VLM model plumbing?
