# Dashboard UX follow-up (deferred)

**Purpose:** Capture the next UX iteration after publisher reporting and gap policy work lands, so a future session can execute incrementally without a risky one-shot redesign.

**Design intent:** Move toward a SaaS-style shell (persistent nav, route-per-concern) while keeping API contracts stable until behavior is trusted.

## Preconditions (done in prior work)

- Publisher history correlates runs (`runId`, `decision`, optional `artifactDir`).
- Gap policy precedence is explicit (persisted file → env → spec) and visible in the control panel.
- System Messages uses bounded scroll/overflow; preset selection updates visible pacing/scheduler numbers locally.
- **Artifact hygiene:** Recorder/playwright scratch files under `artifacts/board-diagnostics/` must not contain credentials; redact or use env-only secrets.

## Phase A — Trust and density (same route)

- Dirty-state for control panel: skip polling merge while editing, or merge only non-form fields.
- Server preset merge: document whether preset wins vs client `autoPublisher` body; align POST handler with product intent if presets should fully replace scheduler numbers on save.
- Publisher runs panel: optional link or copy path from `artifactDir` when debug artifacts exist.

## Phase B — Layout without new routes

- Collapsible sections or tabs inside Runtime Control Panel (Observer / Scheduler / Publisher).
- Safety tile: compact variant (icon + headline + one line of metrics) to free top-row space.

## Phase C — App shell (Phase 3 dashboard UX)

- Left nav + outlet; map pages to `ui-route-map.json` (`/overview`, `/operations`, `/controls`, etc.).
- Follow `ui-refactor-backlog.json` (UI-001 … UI-005).

## Phase D — Publishing playbook & Chrome Recorder (encoded findings)

*Cross-cutting with dashboard UX: optional UI to import/export or validate playbooks later; core work is schema + runner.*

### Canonical format vs exports

- **Chrome DevTools Recorder JSON** (`*.json`): multiple selector strategies per step (e.g. `aria/…`, `#id`, CSS `nth-of-type`, `xpath//…`, `pierce/…`, `text/…`). Treat as **raw capture** and **source for fallback chains**, not final production selectors alone.
- **Playwright JS export** from the same recording: **lossy**—often keeps only the **most fragile** branch (`nth-of-type`, long XPath). **Do not** treat `.js` export as source of truth.
- **Direction:** Versioned **playbook JSON** (aligned with or derived from [`workflow.ppomppu-gonggu-v1.json`](../manifest/workflow.ppomppu-gonggu-v1.json) `publisher_sequence`) + **JSON Schema**; optional **normalizer** from Recorder JSON → playbook.

### Selector policy (for playbook steps and for curating Recorder output)

1. Prefer **scoped** containers (modal, table with known headers), then **text** / **role+name** / stable **`#id`** / **`data-id`** when stable on production.
2. Demote **unscoped** `nth-of-type`, **`click('td')`**, and **full-page XPath** to **fallbacks** only.
3. **Avoid** hard-coded query strings such as `write.php?...&divpage=N` for navigation—`divpage` drifts; prefer **click 글쓰기** + **wait for** write URL (matches repo [`bot.ts`](../../../bot.ts) behavior).
4. Category: prefer **`selectOption({ label })`** (e.g. 유튜브) over opaque numeric `fill` on `#category` unless values are contract-tested.
5. Split **login / captcha** (`#secret_num1`, etc.) into a **separate playbook** or **human-in-the-loop**; do not assume unattended reliability.

### Reference artifacts (diagnostics only)

- `artifacts/board-diagnostics/ppompu.json` — Recorder shape; use for **interpreter design** and **fallback order**, not committed secrets.
- `artifacts/board-diagnostics/ppompu.js` — illustrates **lossy** export; **do not** mirror selector choices.
- `artifacts/board-diagnostics/playwright-test.txt` — exploratory **text / data-id** locators; **not** drop-in until draft row click is **scoped** (modal + row/title), captcha handled, and flow aligned with persistent profile / `launchPersistentContext`.

### Integration opportunities (future implementation)

- Small **TypeScript step runner**: map Recorder-like `type` (`navigate`, `click`, `change`) to Playwright; resolve `selectors[][]` **in order** until one matches (Recorder semantics).
- **Import/export:** playbook envelope (`playbook_version`, `workflow_id`, `steps[]`, optional `selector_profile: playwright`).
- **Conditions:** optional **JSON Logic** or CEL on a **runtime context** object for branching (`when`).
- **Visual designer (later):** any canvas should **emit the same playbook schema** (not proprietary graph-only state).

## References

- [.planning/spec-kit/specs/ui-route-map.json](ui-route-map.json)
- [.planning/spec-kit/specs/ui-refactor-backlog.json](ui-refactor-backlog.json)
- [.planning/spec-kit/manifest/workflow.ppomppu-gonggu-v1.json](../manifest/workflow.ppomppu-gonggu-v1.json)
