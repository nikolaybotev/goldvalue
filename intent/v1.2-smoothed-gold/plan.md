# plan.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Implements | [spec.md](spec.md) Draft 1 |
| Status | Draft 1 — for approval with the spec. Do not start until Q1–Q3 are answered. |
| Stage | 2 · Design |

Each phase is one PR onto `main`. Spec wins over this plan. Python stays the
stdlib reference; vectors stay on the synthetic fixture; no LBMA data is
committed (D15).

## Phase 1 — CLI

Files: `.agents/skills/gold-value-normalizer/scripts/goldvalue.py`, `tests/python/`,
`test-vectors/{cases.json or smooth-cases.json, regenerate.py}`, `SKILL.md`,
`reference.md`.

1. Monthly gold series helper: for each month, the v1 month price (mean of
   daily fixes from 1968, monthly-file value before). Cache it on `GoldTable`.
2. `--smooth 5y|10y|20y`. Window is N×12 months ending at the requested
   period's last month (D17). Mean of those monthly prices. Partial history
   uses what exists and says so (D18).
3. Output: `gold_mode`, `ma_years`, `ma_months`, `spot_usd_per_oz`; when
   smoothing, `gold_usd_per_oz` is the average and `note` names the window and
   the first/last month. `--json`, text, and `--batch` (FR26 columns).
4. Vectors: 2018-12 and a late fixture date at 10y; one year query; 1970 at
   10y (partial); same date at 5y and 20y. Regenerate via `test-vectors/regenerate.py`.
5. SKILL.md: one short section and a trigger line for "smoothed", "moving
   average", "long-horizon gold gauge". Keep the description under 1024
   characters. State that the average is not CPI.

DoD: `pytest tests/python -q` green; vector diff clean.

## Phase 2 — `packages/core`

Files: `packages/core/src/{table,resolve,convert,csv}.ts` (or a small
`smooth.ts`), tests.

1. Port the monthly series and the trailing mean. Same note text as Python.
2. `convert` gains an optional `smooth: 5 | 10 | 20`. Result keys match the CLI.
3. `exportCsv` / `importCsv` grow the FR26 columns; import ignores them.
4. Vitest loads the new vectors (1e-9 relative, exact notes).

DoD: `pnpm --filter @goldvalue/core test` green.

## Phase 3 — Sheet, chart, copy

Files: `apps/web/src/**`, `apps/web/e2e/smooth.spec.ts`, `plan.md` deviations.

1. Header control (FR21). Persisted next to the currency setting. Off by
   default (D19). Changing it recomputes every row.
2. `Price used` shows window, span, and month count (FR23). Partial rows are
   not amber.
3. Chart uses the gauge values. Spot overlay toggle, off by default (D20),
   thinner muted line, shared tooltip. Downloads include the visible series
   (FR24); add any new SVG presentation attributes to `INLINED_PROPERTIES`.
4. Method panel: the FR25 sentence. Do not say the gauge measures inflation.
5. Playwright: AC14–AC18 against the synthetic fixture and stubbed LBMA.

DoD: `pnpm test:e2e` green; initial bundle still under 250 kB gzipped (no new
data files). Deploy is the existing push-to-main workflow. Tag `v1.2.0` after
the production deploy has the control.

## Out of scope

200-day averages, EMA, centered windows, smoothed FX, CPI.
