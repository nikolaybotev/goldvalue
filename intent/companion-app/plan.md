# plan.md — GoldValue implementation plan

| | |
|---|---|
| Implements | [spec.md](spec.md) Draft 3 |
| Status | Draft 3 — for approval before Build |
| Stage | 2 · Design → 3 · Build |

Each phase ends in a mergeable PR with tests. Phases 0–4 deliver v1 (USD-only);
5 adds multi-currency; 6 hardens and deploys. Estimates are agent-session sized,
not calendar time.

## Target repository layout

```
goldvalue/
├── AGENTS.md  REVIEW.md  README.md  LICENSE
├── intent/                               # artifact chain, one folder per change
│   └── companion-app/{intent,spec,plan}.md
├── .agents/skills/gold-value-normalizer/ # agent skill + Python reference (exists)
│   ├── SKILL.md  reference.md  historical-notes.md
│   └── scripts/goldvalue.py
├── test-vectors/                         # golden JSON emitted by Python
│   └── gold-usd.json
├── tools/
│   └── snapshot/sync_data.sh             # copy CLI cache CSVs → apps/web/public/data/
├── packages/core/                        # TypeScript library (no DOM)
│   ├── src/{dates,amounts,units,table,resolve,convert,csv,fx}.ts
│   └── test/
├── apps/web/                             # Vite + Preact SPA
│   ├── public/data/{lbma_daily,monthly,fx_*}.csv + manifest.json  # generated, committed by CI
│   └── src/{app,sheet,chart,store,method,export}/
├── .github/workflows/{ci.yml,data-refresh.yml,deploy-pages.yml}
├── package.json  pnpm-workspace.yaml  biome.json  tsconfig.base.json
└── .gitignore
```

## Phase 0 — Repository scaffolding (this commit + one follow-up)

Files: `README.md`, `AGENTS.md`, `REVIEW.md`, `LICENSE`, `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`.

1. Commit intent/spec/plan, the skill, `AGENTS.md`, and `REVIEW.md` (done).
2. Add pnpm workspace with `packages/core` and `apps/web` stubs; CI runs `pnpm lint && pnpm test` and `pytest .agents/skills/`.
3. License: MIT (D13) — `LICENSE` added.
4. Keep `AGENTS.md` current as commands and conventions land in later phases.

Verification: CI green on an empty workspace.

## Phase 1 — Python reference: vectors and snapshot

Files: `.agents/skills/gold-value-normalizer/scripts/goldvalue.py`, `.agents/skills/gold-value-normalizer/tests/test_goldvalue.py`, `tools/snapshot/sync_data.sh`, `test-vectors/gold-usd.json`.

1. Add `--vectors OUT.json` to `goldvalue.py`: emits ~200 cases covering every resolution branch (pre-1960 annual, 1960–67 monthly, Jan–Mar 1968 AM-only, weekends/holidays roll-back, month/year averages, YTD, `today`, reverse conversions, error cases). Each vector: input, expected `effective`, `price`, `oz`, `GB`, `GBD`, `note`.
2. Add pytest suite: parsing, resolution branches, batch mode, cache refresh logic (mock network).
3. `sync_data.sh` (D14): runs `goldvalue.py --refresh --fetch-only` with `GOLD_PRICE_CACHE_DIR` pointed at a temp dir, then copies `lbma_daily.csv` and `monthly.csv` (later `fx_*.csv`) verbatim to `apps/web/public/data/`, and writes `data/manifest.json` (`{generated, files: {name: {rows, last_date, sha256}}}`) so the SPA can check staleness without parsing everything. Size check (< 130 KB gzipped total).
4. Freeze vector file in repo; CI regenerates and diffs to catch source drift (allow-listed: new dates appended).

Verification: `pytest` passes; `sync_data.sh` output CSVs parse with the CLI's own reader; size budget met.

## Phase 2 — `packages/core` (TypeScript port)

Files: `packages/core/src/*.ts`, `packages/core/test/*.test.ts`.

1. `dates.ts`: `parsePeriod(text) → {kind, anchor}` — same accepted forms as Python.
2. `amounts.ts`, `units.ts`: `parseAmount`, unit aliases (`GB`, goldback, GBD, OZ, USD), `toOz`/`fromOz` with `GB_PER_OZ = 1000`, `GBD_PER_OZ = 50`.
3. `table.ts`: `GoldTable` built from the two CSV texts via a small fixed-schema parser (`parseDataCsv(text, columns)`, no dependency); `merge(newerLbmaRows)`; `lastDaily`, `lastMonth`.
4. `resolve.ts`: `priceForDay/Month/Year` — port line-for-line, including notes text so the UI can show the same messages as the CLI.
5. `convert.ts`: `convert({amount, unit, period}) → Result` matching the CLI JSON shape.
6. `csv.ts`: user-file batch import/export matching `--batch` schema (uses papaparse for quoting robustness; the data-file parser above stays dependency-free).
7. `lbma.ts`: `fetchLbmaSince(date)` — fetch `gold_pm.json`/`gold_am.json`, return rows newer than `date`.
8. Tests: load `test-vectors/gold-usd.json`, assert equality to 1e-9 relative; property tests for `toOz`/`fromOz` round-trip.

Verification: vitest passes; `tsc --noEmit` clean; no DOM imports in `core`.

## Phase 3 — SPA v1 (sheet + chart, USD only)

Files: `apps/web/src/**`, `apps/web/index.html`, `apps/web/vite.config.ts`.

1. Scaffold Vite + Preact + TS; import `@goldvalue/core`.
2. `store/`: signals for rows, settings; `localStorage` persistence; IndexedDB for merged table; boot sequence: load bundled `gold.json` → check staleness → top-up from LBMA → persist.
3. `sheet/`: ARIA grid; columns per FR1; row lifecycle per FR4–FR6; keyboard nav per FR18; per-cell validation state.
4. `chart/`: `<Chart rows unit>` renders SVG with d3-scale/shape/axis; responsive via `ResizeObserver`; tooltip; single-point and empty states; toolbar to switch the axis unit (GB default → GBD / oz) and "save as default" (D11).
5. `method/`: Method panel (FR19) and freshness indicator (FR20).
6. Layout (FR17) with CSS grid and a `min-width` breakpoint; resizable divider.

Verification: Playwright smoke test — AC1, AC2, AC6; Lighthouse performance ≥ 90 on mobile profile.

## Phase 4 — Import/export and offline

Files: `apps/web/src/export/*`, `apps/web/src/sw.ts`, `apps/web/vite.config.ts` (PWA plugin).

1. CSV import (file picker + drag-drop) and export using `core/csv.ts`; per-line error list.
2. SVG export: clone SVG node, inline computed styles, serialize, download. PNG export: draw SVG blob to canvas at 2× DPR, `toBlob`.
3. Service worker (vite-plugin-pwa) caching app shell and `data/*.json`; network-first for LBMA top-up.

Verification: AC3, AC4, AC5 automated where possible (Playwright offline mode).

## Phase 5 — Multi-currency (G7)

Files: `.agents/skills/.../goldvalue.py` (`--currency`), `tools/snapshot/sync_data.sh` (add FX files), `packages/core/src/{fx,parity}.ts`, `apps/web/src/sheet/CurrencySelector.tsx`, `test-vectors/fx.json`, `.agents/skills/.../historical-notes.md`.

1. Python: add `fetch_fx(ccy)` from BIS WS_XRU (daily USD per unit) with cache `~/.cache/gold-value/fx_{ccy}.csv` for `EUR`, `GBP`, `CHF`, `DEM`; `--currency` on single and batch modes; resolution mirrors gold (day roll-back, month/year means). ECB cross-check test for EUR.
2. Python: hard-code the Bretton Woods parity table (spec §6.2a: GBP, CHF, DEM) in `goldvalue.py`; **verify each par value and effective date against IMF IFS / Bank of England / SNB / Bundesbank sources and cite them in `reference.md` before merging.**
3. Python: synthetic bridging at `EUR_PER_DEM = 1 / 1.95583` — EUR before 1999-01-04 from DEM, DEM after 1998-12-31 from EUR — flagged `synthetic`. Resolution order per currency: daily observation → synthetic bridge (EUR/DEM only) → parity in force → earliest available rate. Emit `fx_mode` (`daily` | `parity` | `synthetic` | `extrapolated`) and a human `fx_note` in JSON and batch CSV; the synthetic-euro note text is fixed in spec D10 and reused verbatim by the UI tooltip.
4. Update SKILL.md and reference.md (FX sources, parity table, USD-routing tenet, `fx_mode` semantics); add FX vectors — one per parity step, pre-1999 EUR, post-1998 DEM — to `--vectors`.
5. `sync_data.sh`: add `fx_{eur,gbp,chf,dem}.csv` to the copied set and the manifest.
6. Core: `fx.ts` daily tables + `parity.ts` static table + synthetic bridge + resolution; `convert` gains `currency` and returns `fxMode`, `fxNote`; conversion order per spec §6.4.
7. UI: sheet-wide currency selector (USD, EUR, GBP, CHF, DEM) in the sheet header (D9); amber ⚠ marker with `fxNote` as tooltip for `parity`/`synthetic`/`extrapolated` rows and hollow chart points (FR8a, FR10a); `fx_mode` column in CSV export; Method panel gains the USD-routing tenet, the parity explanation, and the synthetic-euro explanation with a link to `historical-notes.md`.

Verification: vectors pass in both languages; S4 scenario in Playwright; a 1955 GBP row shows £1 = $2.80 parity with ⚠; a 1990 EUR row shows DEM × 1.95583 with the synthetic-euro tooltip; a 2005 DEM row shows EUR / 1.95583 with ⚠.

## Phase 6 — Deployment and hardening

Files: `.github/workflows/data-refresh.yml`, `.github/workflows/deploy-pages.yml`, `README.md`, `apps/web/public/robots.txt`.

1. `data-refresh.yml`: daily cron (after London PM fix, ~16:00 UTC) runs `tools/snapshot/sync_data.sh`; commits if changed; triggers deploy.
2. `deploy-pages.yml`: build `apps/web` with Vite `base: '/goldvalue/'`, publish to GitHub Pages at `nikolaybotev.github.io/goldvalue` (D12).
3. Shared-hosting recipe in README: `pnpm build` then upload `apps/web/dist/` (plus `.htaccess` for SPA fallback if routing is added). Optional: `Dockerfile` serving `dist/` via nginx for Cloud Run.
4. Data-terms notice (LBMA personal/non-commercial) in footer and README.
5. Error budget: Sentry-free; surface fetch failures in the freshness indicator only.

Verification: production URL passes AC1–AC7; daily job has run successfully at least twice.

## Deferred / explicitly out of plan

- Optional HTTP backend (spec D2/D3) — only if a source loses CORS.
- CPI comparison series.
- Other legacy euro currencies (FRF, ITL, NLG, …); the ECU; the East German Mark der DDR (no market USD rate).
- Additional gold units (grams, gold-backed stablecoins).

## Risks

| Risk | Mitigation |
|---|---|
| LBMA changes JSON shape or removes CORS | Snapshot is committed daily; app degrades to snapshot-only; backend fallback path documented |
| GitHub raw / datasets repo disappears | Snapshot retains monthly series; pin a fork |
| BIS API rate limits or schema change | Fetch at build time only; cache; ECB fallback for EUR |
| Parity drift between Python and TS | Golden vectors regenerated and diffed in CI on every PR |
| Bundle bloat on shared hosting | Size budget enforced in CI (`size-limit`) |
