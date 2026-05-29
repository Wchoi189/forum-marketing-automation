# Artifact GC Policy

## How GC Works

GC runs in three ways:
1. **Automatic at startup** — `startServer()` calls `runGarbageCollection()` (unless `DEV_SKIP_BOT=true`)
2. **Periodic** — every 6 hours in `NODE_ENV=production`
3. **Manual** — `POST /api/resource/gc` or `npm run gc` (requires server running)

All GC logic lives in `lib/resourceMonitor.ts`. Entry point: `runGarbageCollection()`.

## What Gets Cleaned

| Target | Path | Rule | Function |
|--------|------|------|----------|
| Publisher run artifacts | `artifacts/publisher-runs/` | Delete dirs older than 7 days | `rotateArtifacts()` |
| Crawlee dataset JSONs | `storage/datasets/default/*.json` | Delete all (data is in SQLite) | `cleanCrawleeDatasets()` |
| Market-data snapshots | `artifacts/competitor-ads/market-data-*/` | Keep latest 2, delete older | `cleanMarketDataSnapshots()` |
| Activity log | `activity_log.json` | Trim to 500 entries if > 1000 | `rotateActivityLog()` |
| Browser caches | `BOT_PROFILE_DIR/Default/Cache` etc | Delete rebuildable cache dirs | `cleanBrowserProfile()` |
| Session handovers | `.agent/session-handovers/*.json` | Keep latest 5, archive rest → `archive/` | `archiveSessionHandovers()` |

## What Is NEVER Cleaned

| Path | Reason |
|------|--------|
| `artifacts/runtime-controls.json` | Live scheduler state — delete = lose gap threshold override |
| `artifacts/browser-storage-state.json` | Playwright session — delete = forced re-login |
| `artifacts/competitor-ads/embeddings/` | Stage 6 dedup store — delete = lose dedup history |
| `artifacts/competitor-ads/llm-cache/` | Ollama response cache — keeps re-runs fast. Add TTL only if disk critical. |
| `.venv/` | Python venv for Trafilatura — required by Stage 0 |
| `artifacts/competitor-ads/competitor-ads.db` | Primary SQLite store |

## Constants (all in resourceMonitor.ts)

```
MAX_ARTIFACT_AGE_DAYS        = 7
MAX_ACTIVITY_LOG_ENTRIES     = 1000
KEEP_ACTIVITY_LOG_ENTRIES    = 500
KEEP_MARKET_DATA_SNAPSHOTS   = 2
KEEP_SESSION_HANDOVERS       = 5
MAX_ARTIFACTS_SIZE_MB        = 500   (hard cap — deletes oldest first)
```

## Running GC Manually

```bash
# Requires server running on :3000
npm run gc

# Dry-run: check current state without cleaning
npm run gc:dry

# Or direct HTTP
curl -X POST http://localhost:3000/api/resource/gc
```

## Extending GC

Add a new cleanup function to `lib/resourceMonitor.ts`, export it, and call it in `runGarbageCollection()`. Add the return value to the function's return type. The `POST /api/resource/gc` response in `routes/api/health.ts` should also expose the new field.
