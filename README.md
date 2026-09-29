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

## Web app

**Live: <https://nikolaybotev.github.io/goldvalue/>**

A static single-page app in `apps/web` (Vite, Preact, TypeScript): a sheet of dated
amounts with live GB / GBD / oz columns, a chart you can download as SVG or PNG, CSV
import and export (the same schema as the CLI's `--batch`), and offline use after the
first visit. Daily LBMA prices are fetched by your browser and kept in IndexedDB;
nothing licensed is stored in this repository or served by the site.

```bash
pnpm install
python3 tools/snapshot/sync_data.py   # monthly series -> apps/web/public/data
pnpm dev                              # or: pnpm build && pnpm preview
pnpm test:e2e                         # Playwright against a preview build, LBMA stubbed
```

### Deploying

GitHub Pages: `.github/workflows/deploy-pages.yml` builds and publishes on every push to
`main`, daily at 16:30 UTC (fresh monthly data), and on demand
(`gh workflow run deploy-pages.yml`). It commits nothing. GitHub disables scheduled
workflows after 60 days without repository activity; a push to `main` or a manual run
starts them again.

Any static host (classic shared hosting, a CDN, an object-storage bucket):

```bash
pnpm install --frozen-lockfile
python3 tools/snapshot/sync_data.py        # real monthly data (no LBMA data is ever copied)
VITE_BASE=./ pnpm build                    # relative URLs: works from any folder
# upload the contents of apps/web/dist/ to the web root or any sub-folder
```

Notes: the offline mode uses a service worker, which browsers allow only on HTTPS (or
`localhost`); serve the folder over HTTPS. `sw.js` and `index.html` should not be cached
for long (the defaults of most hosts are fine). Re-run the two commands and re-upload
whenever you want fresher monthly data; the deploy workflow does this daily.
`VITE_LBMA_BASE` must stay unset in real builds (it exists only for the Lighthouse job).

A non-blocking `live-check` workflow (weekly, or on demand) runs the CLI against the real
LBMA feed and confirms `80000 2018-12` is still 63,979.53 GB, without storing any data.

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

- **LBMA gold prices.** Daily gold prices are fetched from the LBMA (administered by ICE
  Benchmark Administration) by your browser for personal, non-commercial use and are not
  redistributed by this site. This repository contains no LBMA price data: tests and golden
  vectors use a synthetic fixture (`test-vectors/snapshot/`), and the CLI downloads to your own
  cache. Redistributing LBMA data requires a licence from ICE Benchmark Administration, so do
  not commit or publish `lbma_daily.csv` or the LBMA JSON feeds when deploying elsewhere.
- **Monthly gold series** (World Bank Pink Sheet from 1960; Timothy Green / NMA 1833-1959,
  via the `datasets/gold-prices` repository): Open Data Commons PDDL. The site republishes
  this file as `data/monthly.csv`.
- **Code:** MIT (see `LICENSE`).
