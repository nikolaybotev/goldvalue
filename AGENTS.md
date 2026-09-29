# GoldValue

Re-denominates dated currency amounts into gold units (GB = 1/1000 troy oz,
GBD = 1/50 troy oz, OZ). Python CLI + agent skill today; static TypeScript SPA
planned (see `intent/companion-app/`).

## Commands

- Run CLI: `python3 .agents/skills/gold-value-normalizer/scripts/goldvalue.py AMOUNT DATE`
- Prefetch/refresh price cache: `... goldvalue.py --fetch-only` / `--refresh`
- Batch: `... goldvalue.py --batch rows.csv > out.csv` (FR15 schema: `date, amount, currency, label, <passthrough…>, effective, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, granularity, note, fx_rate, fx_effective, fx_mode, fx_note`; computed columns and `currency` are ignored on input, so output re-imports unchanged)
- Regenerate the synthetic fixture, golden vectors, date oracle, and batch outputs (deterministic; CI fails on any diff): `python3 test-vectors/regenerate.py`. It runs `make_fixture.py`, then `goldvalue.py --vectors gold-usd.json --dates-oracle dates.json --cases cases.json` with `GOLD_PRICE_CACHE_DIR=test-vectors/snapshot`, then `--batch` on each `test-vectors/batch-*-in.csv`.
- Publish free data for the web app: `python3 tools/snapshot/sync_data.py` (fetches `monthly.csv` only; writes `apps/web/public/data/{monthly.csv,manifest.json}`, gitignored; `--source-dir DIR` copies from an existing cache instead)
- Live-source drift check (non-blocking weekly workflow): `python3 tools/snapshot/check_drift.py`
- Core tests: `pnpm --filter @goldvalue/core test` (Vitest loads `test-vectors/*` and compares with Python at 1e-9 relative on numbers, exact on text and on batch CSV bytes)
- Node/pnpm: Node 26 (`.nvmrc`), pnpm 12 (`packageManager` in `package.json`; `npm i -g pnpm@12.6.0` if `pnpm` is missing)
- Install: `pnpm install --frozen-lockfile`; lint: `pnpm lint` (Biome; `pnpm format` fixes); types: `pnpm typecheck` (`tsc -b`); tests: `pnpm test` (Vitest per package); build: `pnpm build`
- Web app (`apps/web`, Vite + Preact + signals): `pnpm dev` (Vite dev server), `pnpm build` (`apps/web/dist`), `pnpm preview` (serve `dist`). The site needs `apps/web/public/data/{monthly.csv,manifest.json}`; generate them first with `python3 tools/snapshot/sync_data.py` (network) or `--source-dir test-vectors/snapshot` (synthetic, offline). `VITE_BASE` sets Vite's `base` (default `./`, works from any folder; GitHub Pages will use `/goldvalue/`); every runtime URL is built from `import.meta.env.BASE_URL`.
- Web unit tests: `pnpm --filter @goldvalue/web test` (Vitest, pure modules; `compute.test.ts` replays the golden vectors through the sheet's row logic).
- End-to-end: `pnpm test:e2e` (Playwright, chromium; first time `pnpm --filter @goldvalue/web exec playwright install --with-deps chromium`). It builds and serves `vite preview` on 127.0.0.1:4173. Tests stub `**/data/manifest.json`, `**/data/monthly.csv` and `https://prices.lbma.org.uk/json/*.json` with `page.route` from `test-vectors/snapshot/` (helpers in `apps/web/e2e/support.ts`: `openApp`, `typeRow`, `pasteText`, `cell`), pin the clock with `page.clock.setFixedTime` and expect values from `test-vectors/gold-usd.json`. Never let a test reach the real LBMA.
- Python tests: `python3 -m pip install pytest && python3 -m pytest tests/python -q` (network tests are excluded; `-m network` runs the live smoke test)
- Use a throwaway cache in tests: `GOLD_PRICE_CACHE_DIR=/tmp/gv python3 ...`
- Env hooks: `GOLDVALUE_TODAY=YYYY-MM-DD` pins "today" (`today` keyword, future-date check, month/year-to-date notes); `GOLDVALUE_OFFLINE=1` or `--no-refresh` blocks all network use and stale refresh (missing cache is an error). pytest sets both; never let tests hit the network.
- Negative CLI amounts with a comma or `$` need `--` first (`goldvalue.py -- -1,500 1980`); argparse otherwise reads them as options.

## Conventions

- Python: standard library only in `goldvalue.py`; Python 3.9+ syntax; `from __future__ import annotations`.
- Every price used carries `effective`, `source`, `granularity`, `note`; never print a gold value without them.
- Gold price is always USD per troy oz from the LBMA benchmark (PM fix, AM fallback) or the monthly series pre-1968. Never use non-USD LBMA fixes or dealer quotes.
- Non-USD amounts convert to USD at the historical FX rate first, then to gold (USD-routing tenet). Curated currencies: USD, EUR, GBP, CHF, DEM. Parity-table values apply only before each currency's first BIS observation (1953) and are flagged; pre-1999 EUR is synthetic via DEM at 1.95583; every non-daily FX value carries an `fx_mode` flag and is shown with an amber ⚠.
- Site data files are the CLI's cache CSVs copied verbatim (`monthly.csv`, and `fx_*.csv` from v1.1; never `lbma_daily.csv`, D15); never introduce a second data format.
- Comparisons are gold-denominated, not CPI. Say so when the user asked about "inflation" or "purchasing power".
- Dates: ISO forms `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, plus `Mon YYYY` and `today`. Year/month queries average daily fixes; days roll back to the previous fix.
- Amounts are plain decimals only (no `1e3`, `nan`, `inf`); a period starting after today is an error in single-query and `--batch` mode.
- `--json` `gold_usd_per_oz` is unrounded; `--batch` writes fixed-point numbers (price 4, oz 6, GB 3, GBD 4, USD 2 decimals) with LF endings. `fx_*` keys/columns exist but are empty/`null` until v1.1.
- `packages/core` has no DOM and no Node imports in `src/` (`lib: ES2022`, `types: []`, plus a scan test); `fetch` is injected (`FetchLike`). Dates are `{year, month, day}` triples, never `Date`. Sums use the `fsum` port (not `reduce`) and CSV numbers use `formatFixed` (not `toFixed`) so results match Python.
- **Python and TypeScript change together.** Any change to resolution, parsing, notes, or output in `goldvalue.py` must be mirrored in `packages/core` in the same PR: edit `test-vectors/cases.json` if new cases are needed, run `python3 test-vectors/regenerate.py`, and commit the regenerated vectors with both implementations.
- Synthetic-fixture determinism: `make_fixture.py` uses integer arithmetic and `math.fsum` only (no `random`, no libm, no `sum()` of floats, whose result changed in Python 3.12). Keep it that way so output is byte-identical on every Python version.
- Chart (`apps/web/src/chart`): x is the midpoint of the *requested* period (day itself, month 16th, year 2 July), never the resolved `effective` date; geometry lives in the pure `layout.ts` (unit-tested), the component only renders; log scale exists only while all plotted values are positive; the SVG keeps explicit `width`/`height` because Phase 4b serialises it.
- Docs follow the AI-native SDLC chain: `intent/<change>/intent.md` → `spec.md` → `plan.md`. Update `plan.md` in the same commit when implementation departs from it.

## Architecture

- `.agents/skills/gold-value-normalizer/` — the shipping unit for agents: `SKILL.md` (loaded by agents), `reference.md` (sources/method), `historical-notes.md` (pre-1974 caveats), `scripts/goldvalue.py` (reference implementation).
- `intent/companion-app/` — spec and plan for the SPA. Packages: `packages/core` (TS port, no DOM), `apps/web` (Vite + Preact SPA: `src/{lib,store,sheet,chart}`, `e2e/`), `tools/snapshot` (`sync_data.py`: free CSVs → `apps/web/public/data/`; `check_drift.py`), `test-vectors/` (synthetic fixture in `snapshot/`, `make_fixture.py`, `cases.json`, generated `gold-usd.json`, `dates.json`, `batch-*-out.csv`), `tests/python/` (pytest).
- Cache: `~/.cache/gold-value/{lbma_daily.csv,monthly.csv}`; override with `GOLD_PRICE_CACHE_DIR`.

## Things agents get wrong

- Do not add third-party Python dependencies to the skill script; it must run anywhere with bare `python3`.
- Do not fetch from FRED for LBMA gold series (removed, 404) or scrape xe.com (no API, ToS). Use LBMA, the `datasets/gold-prices` monthly CSV, and BIS for FX.
- The 1 oz Gold Eagle's $50 face value is a coin denomination, not a customs or valuation rate; GBD is a unit defined by this project.
- Pre-1960 monthly values are annual averages repeated per month; don't describe them as monthly data.
- BIS WS_XRU quotes currency per USD (not USD per unit): invert on fetch. There is no BIS DEM series; use `D.DE.EUR` (mark restated in euros, from 1953) for both EUR and DEM, never `XM`. BIS daily data starts 1953 and lags ~1 week.
- The euro did not start 1:1 with the Deutsche Mark (1 EUR = 1.95583 DEM). The Mark der DDR is out of scope.
- Keep `SKILL.md` under 500 lines and its `description` under 1024 characters; put background in `reference.md` / `historical-notes.md`.
- Do not commit the price cache or generated `dist/`.
- In `apps/web` the LBMA table exists only in the visitor's IndexedDB; never write it to `public/`, never let a service worker cache it, and never fetch it in tests (stub it). Keep computation in `@goldvalue/core`; the app only formats and lays out.
- Data CSVs (`apps/web/public/data/*.csv`, `test-vectors/snapshot/*.csv`) are never re-encoded or reformatted; `.gitattributes` marks them `-text` so line endings stay byte-exact. Biome ignores them.
- `packages/core` must not use DOM types or globals (`lib: ES2022`, no `dom`); `apps/web` is the only package with DOM.
- **Never commit or publish LBMA price data** (spec D15: licensed by ICE Benchmark Administration). Tests use the synthetic fixture in `test-vectors/snapshot/`; the browser fetches LBMA itself; `sync_data.py` must never copy `lbma_daily.csv`.
