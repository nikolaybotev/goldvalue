# GoldValue

Re-denominates dated currency amounts into gold units (GB = 1/1000 troy oz,
GBD = 1/50 troy oz, OZ). Python CLI + agent skill today; static TypeScript SPA
planned (see `intent/companion-app/`).

## Commands

- Run CLI: `python3 .agents/skills/gold-value-normalizer/scripts/goldvalue.py AMOUNT DATE`
- Prefetch/refresh price cache: `... goldvalue.py --fetch-only` / `--refresh`
- Batch: `... goldvalue.py --batch rows.csv > out.csv`
- Tests: none yet (plan Phase 1a adds `pytest tests/python -q`; later `pnpm test`)
- Use a throwaway cache in tests: `GOLD_PRICE_CACHE_DIR=/tmp/gv python3 ...`

## Conventions

- Python: standard library only in `goldvalue.py`; Python 3.9+ syntax; `from __future__ import annotations`.
- Every price used carries `effective`, `source`, `granularity`, `note`; never print a gold value without them.
- Gold price is always USD per troy oz from the LBMA benchmark (PM fix, AM fallback) or the monthly series pre-1968. Never use non-USD LBMA fixes or dealer quotes.
- Non-USD amounts convert to USD at the historical FX rate first, then to gold (USD-routing tenet). Curated currencies: USD, EUR, GBP, CHF, DEM. Parity-table values apply only before each currency's first BIS observation (1953) and are flagged; pre-1999 EUR is synthetic via DEM at 1.95583; every non-daily FX value carries an `fx_mode` flag and is shown with an amber ⚠.
- Site data files are the CLI's cache CSVs copied verbatim (`lbma_daily.csv`, `monthly.csv`, `fx_*.csv`); never introduce a second data format.
- Comparisons are gold-denominated, not CPI. Say so when the user asked about "inflation" or "purchasing power".
- Dates: ISO forms `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, plus `Mon YYYY` and `today`. Year/month queries average daily fixes; days roll back to the previous fix.
- Docs follow the AI-native SDLC chain: `intent/<change>/intent.md` → `spec.md` → `plan.md`. Update `plan.md` in the same commit when implementation departs from it.

## Architecture

- `.agents/skills/gold-value-normalizer/` — the shipping unit for agents: `SKILL.md` (loaded by agents), `reference.md` (sources/method), `historical-notes.md` (pre-1974 caveats), `scripts/goldvalue.py` (reference implementation).
- `intent/companion-app/` — spec and plan for the SPA. Planned packages: `packages/core` (TS port, no DOM), `apps/web` (Vite + Preact), `tools/snapshot` (copy cache CSVs → `apps/web/public/data/`), `test-vectors/` (golden JSON from Python).
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
- **Never commit or publish LBMA price data** (spec D15: licensed by ICE Benchmark Administration). Tests use the synthetic fixture in `test-vectors/snapshot/`; the browser fetches LBMA itself; `sync_data.py` must never copy `lbma_daily.csv`.
