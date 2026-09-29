# plan.md — GoldValue implementation plan

| | |
|---|---|
| Implements | [spec.md](spec.md) Draft 4 |
| Status | Draft 4 — fresh-eyes review applied; **blocked on owner gate G0 (LBMA data licensing)** before Phase 1b |
| Stage | 2 · Design → 3 · Build |

Each phase is one PR with a definition of done (DoD). v1 (USD-only) ships at the
end of Phase 5; Phases 6a–6c add multi-currency (v1.1). Update `plan.md` in the
same commit whenever implementation departs from it.

## Owner gate G0 — LBMA data licensing (decide before Phase 1b)

Research on 2026-09-28: the LBMA Gold Price is administered by ICE Benchmark
Administration (IBA). IBA/LBMA state that a licence is required to obtain, use
or **redistribute** historical benchmark data; redistributors pay a licence fee
(2026 fee schedule lists non-real-time redistribution from USD 9,000 a year);
LBMA moved its historical tables behind a portal (Nov 2025) that requires
self-certification as non-commercial/educational. Personal, non-commercial use
is permitted. Publishing a daily LBMA snapshot in a public repo or on a public
site (spec D14, §6.3) is redistribution.

| Option | What ships | Cost to spec |
|---|---|---|
| **A (recommended)** | No LBMA rows in the repo or on the site. The site ships the free monthly series (World Bank, PDDL) and BIS FX; the visitor's browser fetches LBMA JSON directly (user-initiated, personal use), caches it in IndexedDB, and shows an attribution/terms notice. CLI users fetch LBMA to their own cache as today. Tests use a **synthetic** fixture (deterministic made-up prices in the same CSV shape), so nothing licensed is committed. | D1/D14/§6.3/NFR1/AC1/AC5 amended: first visit downloads ~1.8 MB (once per 12 h) instead of a 76 KB snapshot; offline works after first load via IndexedDB (`persist()`), not the service worker; AC1's real-price number becomes a non-blocking live check. |
| B | Obtain an IBA redistribution licence (or written permission) and keep spec Draft 4 unchanged. | Fees and paperwork; owner-only. |
| C | Monthly series only (no LBMA at all). | Loses day-level precision from 1968; largest product change. |

Until G0 is answered, the agent may execute Phases 0, 1a, 2, and everything in
3–4 that does not read real LBMA data, using the synthetic fixture. Phase 1b
(real snapshot, `sync_data.py` data set), Phase 5 (deploy), and the AC1
real-value check are held.

## Target repository layout

```
goldvalue/
├── AGENTS.md  REVIEW.md  README.md  LICENSE  .gitattributes  .nvmrc
├── intent/companion-app/{intent,spec,plan}.md
├── .agents/skills/gold-value-normalizer/
│   ├── SKILL.md  reference.md  historical-notes.md
│   └── scripts/goldvalue.py
├── tests/python/                          # pytest for goldvalue.py (kept out of the shipped skill folder)
├── test-vectors/
│   ├── snapshot/{lbma_daily,monthly}.csv  # pinned fixture (content per G0); fx_*.csv added in 6a
│   ├── gold-usd.json  dates.json  batch-*.csv  fx.json(6a)
├── tools/snapshot/sync_data.py            # stdlib; copies cache CSVs -> apps/web/public/data + manifest
├── packages/core/src/{dates,amounts,units,csvdata,table,resolve,convert,csv,lbma}.ts  (+ fx,parity in 6b)
├── apps/web/
│   ├── public/data/                       # generated: monthly.csv, manifest.json, (lbma_daily.csv per G0), fx_*.csv
│   ├── e2e/                               # Playwright specs
│   └── src/{app,sheet,chart,store,method,export,sw}/
├── scripts/check-size.mjs
├── .github/workflows/{ci.yml,deploy-pages.yml,weekly-drift.yml}
└── package.json  pnpm-workspace.yaml  biome.json  tsconfig.base.json
```

## Acceptance-criteria coverage map

| AC | Test | Phase |
|---|---|---|
| AC1 | Playwright with `page.clock` pinned inside the fixture; expected values read from `test-vectors`. Real-price check (63,979.53 GB) is a non-blocking live job. | 3a |
| AC2 | rAF-based DOM assertion | 3b |
| AC3 | vitest round-trip + comparison with Python-generated `test-vectors/batch-*.csv` | 4a |
| AC4 | Playwright download; PNG IHDR width/height = 2× SVG `width`/`height` | 4b |
| AC5 | Playwright `context.setOffline(true)` against `vite preview` | 4c |
| AC6 | Playwright | 3c |
| AC7 | `pytest` + `vitest` on the same vector JSON | 1b, 2 |
| AC7a | Playwright: FR12 midpoint + side-by-side, 899/900 px layout, FR18 keymap, FR2a future date; `@axe-core/playwright` | 3b, 3c |
| AC8–AC11 | `e2e/fx.spec.ts` + FX vectors | 6c |

## Phase 0 — Scaffolding and CI skeleton

Files: `package.json` (`packageManager`, `engines`), `.nvmrc`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` (`lib: ["ES2022"]` for core), `biome.json`, `.gitattributes` (`apps/web/public/data/*.csv -text`, `test-vectors/snapshot/*.csv -text`), `.github/workflows/ci.yml`, empty `packages/core`, `apps/web`.

1. Node and pnpm pinned; CI uses `pnpm/action-setup` and `--frozen-lockfile`.
2. CI jobs (each added as its content lands): `python` (pytest 3.9 + 3.12, vector diff), `node` (biome, `tsc -b`, vitest, build, `scripts/check-size.mjs`), `e2e` (Playwright chromium, optional webkit), `lighthouse` (`lhci`, median of 3).
3. Owner-only prerequisite, noted here so the agent doesn't stall: Pages source must be set to "GitHub Actions" (Phase 5).

DoD: CI green on the empty workspace. Update `AGENTS.md` commands (`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, Node/pnpm versions, the "data CSVs are never re-encoded" rule).

## Phase 1a — Reference CLI changes (spec §5.6 items 1–3 and test hooks)

Files: `.agents/skills/gold-value-normalizer/scripts/goldvalue.py`, `tests/python/{conftest.py,test_*.py}`, `SKILL.md`, `reference.md`.

1. `--batch` emits the FR15 schema (`date, amount, currency, label…passthrough, effective, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, granularity, note, fx_rate, fx_effective, fx_mode, fx_note`); `amount` echoes the input token; LF line endings; computed export columns are ignored on input and an imported `currency` column is dropped and regenerated.
2. `--json` and text output expose top-level `effective`, `granularity`, `note`, `points` (keep old keys as aliases where SKILL.md/reference.md document them).
3. Behavior fixes: `--batch` rejects future dates like single-query mode; month queries for the current month say "(month to date)"; `parse_amount` rejects non-finite values (`nan`, `inf`) and exponent forms are kept only if intentional (decide and document).
4. Test hooks: `GOLDVALUE_TODAY=YYYY-MM-DD` overrides "today"; `GOLDVALUE_OFFLINE=1` (or `--no-refresh`) prevents network and stale-refresh.
5. pytest scaffolding: `conftest.py` loads the script via `importlib.util.spec_from_file_location`; `tmp_path` sets `GOLD_PRICE_CACHE_DIR`; `_download` is monkeypatched; network tests are `@pytest.mark.network` and excluded by default.
6. Tests: parsing (every FR2 form, lenient `strptime` cases), resolution branches, batch schema/round-trip, hooks.

DoD: `pytest tests/python -q` green on 3.9 and 3.12. `AGENTS.md`: pytest command, env hooks, batch schema.

## Phase 1b — Pinned fixture, vectors, data sync *(real data gated by G0)*

Files: `test-vectors/snapshot/*`, `test-vectors/{gold-usd.json,dates.json,batch-*.csv}`, `tools/snapshot/sync_data.py`, `.github/workflows/weekly-drift.yml`.

1. Fixture per G0 (A: synthetic deterministic prices generated by a committed script; B: real snapshot).
2. `--vectors OUT.json` reads a committed case-input file (not the shipping script) and writes `json.dumps(sort_keys=True, indent=2)` output plus trailing newline, from the fixture with `GOLDVALUE_OFFLINE=1`. Schema is spec §5.7 extended with `input.currency`, `expected.fx_note`, `expected.points`. Families per §5.7; the London closure boundary is 1968-03-15 → 1968-04-01.
3. `dates.json`: accept/reject strings generated by the CLI's own parser (oracle for `dates.ts`).
4. `sync_data.py` (stdlib): runs the CLI fetch into a temp cache, copies CSVs verbatim to `apps/web/public/data/`, writes `manifest.json` (`files: {name: {rows, last_date, sha256}}`, no timestamp, so unchanged data means no diff), and fails if any file's row count drops more than 1% from the previous manifest.
5. CI: regenerate vectors from the fixture and diff byte-for-byte (determinism). `weekly-drift.yml`: non-blocking comparison of live sources with the fixture.

DoD: AC7 (Python side) green; `AGENTS.md`: vectors command and the rule "change Python and TS together, regenerate vectors, commit all".

## Phase 2 — `packages/core` (v1 USD)

Files: `packages/core/src/*.ts`, `packages/core/test/*.test.ts`.

1. `dates.ts` (all FR2 forms; tested against `dates.json`), `amounts.ts`, `units.ts` (`GB_PER_OZ=1000`, `GBD_PER_OZ=50`).
2. `csvdata.ts`: `parseDataCsv(text, columns)` accepting `\r\n` and `\n` (tested with CRLF input).
3. `table.ts`, `resolve.ts` (line-for-line port including note texts), `convert.ts` (result shape = CLI JSON), `csv.ts` (papaparse; FR14/FR15 with the dedupe rule), `lbma.ts` (`fetchLbmaSince(fetchFn, date)`; fetch injected so core needs no DOM lib).
4. Vitest loads `test-vectors/gold-usd.json`: 1e-9 relative on doubles, exact on text.

DoD: `pnpm --filter @goldvalue/core test` green; `tsc --noEmit` clean; no DOM imports. `AGENTS.md`: core commands and the no-DOM rule.

## Phase 3a — App shell, store, sheet

Files: `apps/web/**` scaffold (Vite + Preact + signals, `build.target: 'safari16'`, `base: process.env.VITE_BASE ?? './'`, runtime URLs via `import.meta.env.BASE_URL`).

1. Store: signals for rows/settings; `localStorage` persistence and Clear (FR7); boot: read manifest → load data → staleness rule (previous London business day, last attempt >12 h) → top-up after interactive (per G0 option) → IndexedDB derived cache invalidated when manifest sha differs; `navigator.storage.persist()`; offline/unavailable state (FR20).
2. Sheet: ARIA grid; columns per FR1; label column toggle (FR6); GBD/oz toggles (FR8); FR2a errors. Keymap: navigate mode (arrows move, Enter/F2/typing edits); edit mode (Enter commits+down, Tab commits+right, Esc cancels, arrows move caret); TSV/CSV paste fills rows (S2); row reorder via move buttons/keys with drag as enhancement (FR5); sort by date.

DoD: AC1 (fixture values), FR18 keymap and FR2a Playwright specs green. `AGENTS.md`: `pnpm dev/build/preview`, `pnpm test:e2e`, `VITE_BASE`.

## Phase 3b — Chart

`chart/`: d3-scale/shape/axis SVG; x = midpoint of requested period (day itself, month 16th, year 2 July; FR12); side-by-side same-x points with shared tooltip; linear Y, log toggle only when all values positive, negatives plotted (FR10); axis-unit toolbar with "save as default" (D11); nominal overlay toggle (off by default); `ResizeObserver`; empty/single-point states.

DoD: AC2, AC7a (FR12) green.

## Phase 3c — Layout, Method, freshness, accessibility

Wide/narrow layout, resizable divider, collapsible chart (FR17); Method panel (FR19) with the "gold-denominated, not CPI" statement and **absolute GitHub URLs** to `historical-notes.md`; freshness indicator and Refresh (12 h rate limit, FR20); attribution/terms footer (per G0); axe-core.

DoD: AC6, AC7a (899/900 px, axe) green; Lighthouse ≥ 90 mobile; `check-size.mjs` enforces gold data ≤ 130 KB gz and initial `dist/` (excluding `fx_*`) ≤ 250 KB gz.

## Phase 4a — CSV import/export

Import per FR14 (file picker, drag-drop, 5 MB limit, per-line errors); export per FR15. DoD: AC3.

## Phase 4b — SVG/PNG download

Serialize SVG with explicit `width`/`height`, `xmlns`, inlined styles, system fonts; PNG canvas = **exactly 2× the SVG's `width`/`height`** (independent of `devicePixelRatio`), `await img.decode()` before `drawImage`. DoD: AC4.

## Phase 4c — Service worker and offline

`vite-plugin-pwa` with `globPatterns` including `csv,json`; precache shell + `monthly.csv`, `manifest.json` (and `lbma_daily.csv` under G0-B); `fx_*.csv` cached on first use; the LBMA top-up response is never cached by the SW; update strategy: prompt-free `autoUpdate`, IndexedDB discarded on manifest sha change; AC5 runs against `vite preview` (SW inactive in `vite dev`). DoD: AC5.

## Phase 5 — Deploy and v1 tag *(held until G0 is answered)*

1. `deploy-pages.yml`: triggers on `push` to main, daily `schedule` (~16:30 UTC), and `workflow_dispatch`; runs `sync_data.py` **before** `vite build` and commits nothing (avoids `GITHUB_TOKEN` non-triggering and history noise); `permissions: {pages: write, id-token: write, contents: read}`, `environment: github-pages`, `upload-pages-artifact` + `deploy-pages`; `VITE_BASE=/goldvalue/`.
2. Owner action: Pages source → GitHub Actions (`gh api` if permitted).
3. README: shared-hosting recipe (`VITE_BASE=./ pnpm build`, upload `apps/web/dist/`); Cloud Run static container optional. Data-terms notice per G0.
4. Tag `v1.0.0`.

DoD: production URL passes AC1–AC7a; two scheduled deploys observed. `AGENTS.md`: deploy workflow and `gh workflow run deploy-pages.yml`.

## Phase 6a — CLI: FX and parity (v1.1)

Files: `goldvalue.py`, `tests/python/`, `test-vectors/{snapshot/fx_*.csv,fx.json}`, `tools/snapshot/sync_data.py`, `reference.md`, `SKILL.md`, `historical-notes.md`.

1. `--currency EUR|GBP|CHF|DEM` (valid only with `--from USD`; error otherwise; `currency` column reflects it in `--batch`).
2. BIS fetcher: `D.GB.GBP`, `D.CH.CHF`, `D.DE.EUR` (per-USD quotes inverted to `usd_per_unit`; skip blank/`NaN` values; use `TIME_PERIOD`/`OBS_VALUE`). Cache/snapshot files: `fx_gbp.csv`, `fx_chf.csv`, `fx_eur.csv` only; `usd_per_dem = usd_per_eur / 1.95583`. `--fetch-only` also fetches FX.
3. Parity table (spec §6.2a) in the CLI; sources: any of IMF IFS, Bank of England, SNB, Bundesbank or a central-bank history page; values that cannot be confirmed stay, marked `unverified` in `reference.md` and noted in the PR (does not block merge).
4. Resolution: rate from the daily table, else parity if before the first observation; `synthetic` set for EUR before 1999-01-04 / DEM after 1998-12-31 regardless of data source; `fx_mode` = highest of daily < synthetic < parity < extrapolated, `fx_note` lists all; EUR before 1953-09-01 = DEM parity × 1.95583. Period straddling a first observation: mean of the observations if any exist, else parity at the midpoint.
5. Emit `fx_rate`, `fx_effective`, `fx_mode`, `fx_note` in text, `--json`, `--batch`. Vectors: each parity step, day before/after each first observation, EUR 1998-12-31/1999-01-04, DEM likewise, EUR 1950 (parity + synthetic), GBP 1900 (extrapolated), CHF 1999-01-04 = 0.7292 USD. BIS 1-week lag note (`fx_note` when rate older than 3 days).
6. Check each `fx_*.csv` ≤ 110 KB gz; round stored inverse to ~8 decimals if not.

DoD: pytest + vector determinism green. `AGENTS.md`: `--currency`, FX vectors command, corrected parity sentence.

## Phase 6b — Core FX

`fx.ts`, `parity.ts`, `convert` gains `currency`, returns `fxMode`, `fxNote`, `fxRate`, `fxEffective`; ratio-of-means for month/year; `currency` passthrough warning on import. DoD: FX vectors green in vitest (AC12).

## Phase 6c — UI FX

Sheet-wide currency selector (D9); lazy `fx_*.csv` download; amber ⚠ with `fxNote` tooltip and hollow chart points; `fx_*` in export; Method panel gains the USD-routing, parity, and synthetic-euro text. DoD: AC8–AC11, AC13 (Playwright). Tag `v1.1.0`.

## Deferred / explicitly out of plan

- Optional HTTP backend (spec D2/D3) — only if a source loses CORS.
- CPI comparison series.
- Other legacy euro currencies (FRF, ITL, NLG, …); the ECU; the East German Mark der DDR.
- A richer pre-1940 GBP table.

## Risks

| Risk | Mitigation |
|---|---|
| LBMA licensing (G0) | Owner decision; option A removes redistribution entirely |
| LBMA changes JSON shape, removes CORS, or closes the endpoint | Drift job; degrade to monthly series; backend fallback documented |
| BIS schema change or outage | Fetch at build time only; ECB/FRED are cross-checks, not replacements (ECB starts 1999) |
| Parity drift between Python and TS | Byte-diffed vectors in CI; change both together |
| Bundle bloat | `check-size.mjs` in CI |
| Scheduled workflows disabled after 60 days of repo inactivity | Daily deploys are commits-free, so add a monthly keep-alive or note in README |
