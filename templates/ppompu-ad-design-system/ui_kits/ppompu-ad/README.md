# SharePlan Ppompu Ad UI Kit

## Purpose
A modular, inline-styled HTML version of the SharePlan forum ad for Ppompu's OTT market board.

## Key Design Decisions
- **All styles are inline** — Ppompu's forum editor does not support `<style>` tags or external CSS.
- **Product sections are self-contained blocks** — to add or remove a product, copy/delete the entire section block between the clearly marked comments.
- **Pricing cards use a grid** — adding/removing cards inside a section is easy; the grid auto-reflows.

## Files
- `index.html` — full interactive preview of the ad (uses `<style>` for preview convenience)
- `template.html` — the **actual production-ready inline-styled HTML** to paste into Ppompu
- `ProductSection.jsx` — React component (for design reference/prototyping only)
- `PricingCard.jsx` — React component for a single pricing card
- `NoticeBox.jsx` — React component for the 필독 notice block
- `CTABlock.jsx` — React component for the CTA + contact section

## How to Add a New Product
1. Open `template.html`
2. Copy the block between `<!-- PRODUCT SECTION START: [Name] -->` and `<!-- PRODUCT SECTION END: [Name] -->`
3. Paste it after the last product section, before the Notice block
4. Update: section heading color/border, plan names, prices, and the accent colors throughout

## Accent Color Pairs (per service)
| Service | Heading | Border | Card BG | Badge BG |
|---|---|---|---|---|
| YouTube | `#be123c` | `#fecaca` | `#fff1f2` | `#e11d48` |
| Coursera | `#0369a1` | `#bae6fd` | `#f0f9ff` | `#0284c7` |
| New service | pick from brand palette | tinted version | very light tint | main accent |
