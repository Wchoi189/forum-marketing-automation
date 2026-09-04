---
title: Competitor Intelligence & Ad Parser
status: shipped
initiative_id: competitor-intel
tags:
  - competitor-intel
  - crawlee
  - cheerio
  - ollama
  - sqlite
---

# Competitor Intelligence & Ad Parser

> Pipeline for extracting, analyzing, and structuring competitor ad postings on Ppomppu using Crawlee, Cheerio, and local Ollama inference.

## 1. Initiative Overview

The competitor intelligence subsystem scrapes forum boards, filters noise via Cheerio HTML pre-processing, feeds post content through local Ollama LLMs for structured entity extraction, and stores the resulting ads in SQLite for analytics and SOV calculation.

---

## 2. Documentation Map

| Document | Purpose |
| :--- | :--- |
| **[playbook.md](playbook.md)** | Extraction operational playbook, selectors, and troubleshooting |
| **[roadmap.md](roadmap.md)** | Subsystem evolution roadmap |
| **[reference/프로젝트소개_PpomppuOTT_v1.md](reference/프로젝트소개_PpomppuOTT_v1.md)** | Domain background and Ppomppu OTT product introduction |
| **[plans/competitor-ads-intel.plan.json](plans/competitor-ads-intel.plan.json)** | Master execution plan |
| **[specs/shipped/ppomppu-ott-competitor-ads-intel-v1.json](specs/shipped/ppomppu-ott-competitor-ads-intel-v1.json)** | Core implementation spec (shipped) |
