# GoldValue

Re-denominate dated US dollar amounts into gold units so values from different
eras are comparable:

- **GB** — goldback, 1/1000 troy oz of gold
- **GBD** — gold-backed dollar, 1/50 troy oz (50 GBD per troy oz)
- **OZ** — troy ounce

Prices come from the LBMA Gold Price (daily, 1968–present) and the World Bank /
Timothy Green monthly series (1833–present), fetched once and cached locally.

## Contents

| Path | What |
|---|---|
| `.agents/skills/gold-value-normalizer/` | Agent skill (Cursor / Claude / any AGENTS.md-aware agent) with the reference Python CLI `scripts/goldvalue.py` |
| `intent/<change>/` | AI-native SDLC artifact chain per change: `intent.md` → `spec.md` → `plan.md` (currently `companion-app`) |
| `AGENTS.md` | Agent-facing repo guide: commands, conventions, architecture, known pitfalls |
| `REVIEW.md` | PR review policy: passes, severity, what to skip |

## Quick start (CLI)

```bash
python3 .agents/skills/gold-value-normalizer/scripts/goldvalue.py 80000 2018-12
python3 .agents/skills/gold-value-normalizer/scripts/goldvalue.py 200000 today
python3 .agents/skills/gold-value-normalizer/scripts/goldvalue.py --batch series.csv > series_gold.csv
```

Standard library only (Python 3.9+). Cache lives in `~/.cache/gold-value/`
(override with `GOLD_PRICE_CACHE_DIR`).

## Web app (in development)

A static single-page app in `apps/web` (Vite, Preact, TypeScript): a sheet of dated
amounts with live GB / GBD / oz columns and a chart. Daily LBMA prices are fetched by
your browser and kept in IndexedDB; nothing licensed is stored in this repository.

```bash
pnpm install
python3 tools/snapshot/sync_data.py   # monthly series -> apps/web/public/data
pnpm dev                              # or: pnpm build && pnpm preview
pnpm test:e2e                         # Playwright against vite preview, LBMA stubbed
```

## Using as an agent skill

Inside this repo the skill is discovered automatically from `.agents/skills/`.
To use it elsewhere, symlink or copy it into that workspace's skills directory, e.g.

```bash
ln -s "$(pwd)/.agents/skills/gold-value-normalizer" ~/.cursor/skills/gold-value-normalizer
```

## Method

Conversions are gold-denominated, not CPI-based. See
`.agents/skills/gold-value-normalizer/reference.md` for sources and resolution rules and
`.agents/skills/gold-value-normalizer/historical-notes.md` for the simplifying assumptions
in the pre-1974 era.

## Data terms

LBMA price data is provided for personal, non-commercial use under LBMA's terms.
The monthly series is Open Data Commons PDDL.
