# Build Performance Audit

**Date:** 2026-05-13
**Status:** Findings complete, roadmap pending
**Branch:** `fiori-integration`

---

## Executive Summary

The production build transforms **12,726 modules** into a **3.8 MB main bundle** (`index.js`) and **353 additional chunks** totaling 17 MB uncompressed (1.2 MB gzipped). The root cause is almost entirely transitive dependencies from `@copilotkit/*`. Your own code is 26 files, 222 KB total.

**The interactive treemap is at `dist/stats.html`** (4.4 MB) — open in browser for visual breakdown.

---

## 1. Root Cause: Dependency Chain

```
@copilotkit/shared (1 of 4 copilotkit packages you install)
  └── @segment/analytics-node@2.1.2
        └── node-fetch →  Node.js builtins (stream, http, url, https, zlib)
              → 5 externalization warnings; crashes at runtime if called

@copilotkit/react-core
  └── streamdown@1.6.11 (markdown renderer for AI chat responses)
       ├── mermaid@11.14.0            → diagram rendering (all 18+ diagram types)
       │    └── cytoscape@3.33.2      → graph layout engine
       ├── shiki@3.23.0               → syntax highlighter
       │    ├── @shikijs/langs        → 228 language grammar files
       │    └── @shikijs/themes      → 65 color theme files
       └── (via react-core direct)
            └── katex@0.16.22         → math formula fonts (50+ woff/woff2/ttf files)
```

**All heavy transitive deps flow through 2 direct dependencies.**

---

## 2. Quantified Impact

### Bundle Composition (measured from dist/)

| Category | Files | Raw Size | Gzip | What |
|----------|-------|----------|------|------|
| **Main bundle** (`index-BxwN77SR.js`) | 1 | 3.8 MB | 1.2 MB | Your code + all CopilotKit runtime + shared deps |
| **Secondary bundle** (`index-DH4Lff5C.js`) | 1 | 780 KB | 130 KB | React entry + routed components |
| **Shiki syntax langs** | 228 | ~4-5 MB | ~1.0 MB | COBOL, Fortran, emacs-lisp (780 KB), Wolfram (260 KB), 224 more |
| **Shiki themes** | 65 | ~1.2 MB | ~240 KB | catppuccin, gruvbox, dracula, night-owl, 61 more |
| **Mermaid + diagrams** | 27 | ~2.0 MB | ~500 KB | 18 diagram types + cytoscape (436 KB) + dagre + layout |
| **KaTeX fonts** | 52 | 1.2 MB | — | Already separate .woff/.woff2 files, not in JS bundle |
| **Code block renderer** | 1 | 208 KB | 69 KB | `code-block-*.js` — Shiki + markdown rendering pipeline |
| **Your own code** | 26 | ~222 KB | ~50 KB | App.tsx, pages, components, hooks |

### Totals

| Metric | Value |
|--------|-------|
| Total `dist/` size | 23 MB |
| Total JS (uncompressed) | 17 MB |
| Total JS (gzip) | ~3.5 MB |
| Total chunks | 354 |
| Modules transformed | 12,726 |
| Build time | 21.3s |

### Key Insight

**~95% of the 12,726 transformed modules are NOT your code.** The Shiki highlighter alone contributes 293 files (228 langs + 65 themes), Mermaid contributes 31 files, and KaTeX contributes 50+ font files.

---

## 3. Severity Assessment

| Issue | Severity | Impact | Notes |
|-------|----------|--------|-------|
| `@segment/analytics-node` in browser | **Critical** | Runtime crash risk | Node.js-only SDK bundled in browser build. `stream`, `http`, etc. externalized — will `ReferenceError` if analytics code executes |
| 3.8 MB main bundle | **High** | TTI 5-10s on 3G | Vite warning threshold is 500 KB; this is 7.6x over |
| 228 Shiki language grammars | **High** | +4 MB raw bundle | Only needs JS/TS/HTML/CSS/JSON for this project |
| 65 Shiki themes | **Medium** | +1.2 MB raw bundle | Only needs 1-2 themes |
| 18 Mermaid diagram types | **Medium** | +2 MB raw bundle | Only needed if AI responses contain mermaid diagrams |
| KaTeX fonts as separate assets | **Low** | 1.2 MB but lazy-loaded | Browser only downloads fonts if math is rendered; already split into own chunks |
| No route-level code splitting | **Medium** | Loads everything on first page | ReactFlow (Operations), Recharts (Analytics), CopilotKit (all pages) all in initial bundle |

---

## 4. What the Previous AI Assessment Got Wrong

1. **"Switch to `@segment/analytics-next`"** — The Segment SDK is not a direct import. It's a transitive dep of `@copilotkit/shared`. You can't simply swap it without forking CopilotKit.

2. **"Whitelist languages in your Shiki config"** — Shiki is imported by `streamdown`, not your code. You can't configure it from `vite.config.ts` without patching `streamdown` or using Vite aliases.

3. **"Use `import('mermaid')` for dynamic imports"** — Mermaid is not directly imported by your code either. It's bundled because `streamdown` imports it statically.

The real fix is at the **Vite bundler level** (manualChunks, aliases, externals) or at the **dependency level** (replacing `streamdown`).

---

## 5. Recommended Roadmap

### Sprint 1: Quick Wins (Vite config only, no dependency changes)

**Estimated impact:** -1.5 MB gzip on main bundle

1. **Exclude `@segment/analytics-node` from browser build**
   - Add to `vite.config.ts` `resolve.alias`: map `@segment/analytics-node` to a no-op stub
   - It's analytics telemetry — no functional impact
   - Eliminates the 5 externalization warnings

2. **`manualChunks` to isolate CopilotKit heavy deps**
   ```ts
   output: {
     manualChunks: {
       copilotkit: ['@copilotkit/react-core', '@copilotkit/react-ui', '@copilotkit/runtime-client-gql'],
       shiki: ['shiki', '@shikijs/langs', '@shikijs/themes'],
       mermaid: ['mermaid', 'cytoscape', 'cytoscape-cose-bilkent', 'cytoscape-fcose', 'dagre', 'khroma'],
       katex: ['katex'],
     }
   }
   ```
   - Moves 300+ files out of the main bundle into separate chunks
   - Main bundle shrinks; CopilotKit loads only when chat sidebar opens
   - **Does NOT reduce total download size** but defers loading

3. **Route-level dynamic imports**
   - `React.lazy` for AnalyticsPage (recharts), PipelineCanvas (@xyflow/react)
   - These are your own imports — straightforward to change

### Sprint 2: Targeted Pruning

**Estimated impact:** -3 MB raw, -600 KB gzip

4. **Replace `streamdown` with a lighter markdown renderer**
   - Audit: which Shiki languages/themes does streamdown actually use at runtime?
   - Option A: patch `streamdown` to accept a language whitelist
   - Option B: replace with `react-markdown` + a minimal Shiki config that only loads needed langs
   - This is the **single biggest win** — eliminates 228 language + 65 theme files

5. **Selective Mermaid loading**
   - Mermaid v11 supports loading only specific diagram types
   - Configure to load only `flowchart`, `sequenceDiagram`, `gantt` (common in AI responses)
   - Drops 12+ unused diagram types + their layout engines

### Sprint 3: Dependency Rationalization

**Estimated impact:** TBD, architectural decision

6. **Evaluate CopilotKit scope**
   - Current: 4 packages, 160 MB on disk, pulls in 12,000+ transitive modules
   - Used for: AI coach sidebar on KakaoDashboard + CoachSidebar
   - Question: Is the AI coach feature core to the product? If yes, accept the bundle cost and optimize around it. If no, removing CopilotKit eliminates 90% of the bloat.

7. **Move server-only deps to proper scope**
   - `playwright`, `crawlee`, `better-sqlite3`, `pg`, `openai` are in `dependencies` but only used by server code
   - Move to `devDependencies` or split into a separate `package.json` for the server
   - Won't affect browser bundle (Vite already excludes them) but clarifies the dependency graph and reduces `npm install` time

---

## 6. Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Excluding `@segment/analytics-node` | None — it's telemetry, not functional | Verify CopilotKit still works without analytics |
| `manualChunks` isolation | Low — chunks still downloaded, just deferred | Monitor network waterfall in dev tools |
| Replacing `streamdown` | Medium — may break markdown rendering in chat | Visual regression test the coach sidebar |
| Removing CopilotKit | High — removes AI coach feature entirely | Only if product decision |

---

## 7. Files to Modify

| File | Change |
|------|--------|
| `vite.config.ts` | Add `visualizer` plugin (done), `manualChunks`, `resolve.alias` for segment no-op |
| `src/pages/AnalyticsPage.tsx` | `React.lazy` wrapper (if route-level splitting) |
| `src/PipelineCanvas.tsx` | `React.lazy` wrapper (if route-level splitting) |
| `package.json` | Possibly replace `streamdown` dependency (Sprint 2) |

---

## 8. Artifacts

- `dist/stats.html` — Interactive treemap (open in browser)
- `conversation-snippet.md` — Original build log
- `artifacts/conversation-snippet2.md` — Previous AI assessment
