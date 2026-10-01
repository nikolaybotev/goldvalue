# plan.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Implements | [spec.md](spec.md) Draft 2 |
| Status | Draft 2 — aligned to the spec review; plan review still to come |
| Stage | 2 · Design |

Each phase is one PR onto `main`. Spec wins over this plan. Python stays the
stdlib reference; vectors stay on the synthetic fixture; no LBMA data is
committed (D15).

## Phase 1 — CLI

Files: `.agents/skills/gold-value-normalizer/scripts/goldvalue.py`, `tests/python/`,
`test-vectors/{cases.json or smooth-cases.json, regenerate.py}`.

1. Monthly gold series helper: for each month, the v1 month price (mean of
   daily fixes from 1968, monthly-file value before). Cache it on `GoldTable`.
2. `--smooth 5y|10y|20y`, valid only with `--from USD` (error otherwise).
   Window is N×12 months ending at the snapshot month (D17). Full months
   except the last, which clips to the snapshot day. Skip missing months;
   `gold_mode=partial` when fewer than N×12 months are priced (before
   1842-12 for 10y). `--price-only` prints the mean and the note.
3. Output: `gold_mode`, `ma_years`, `ma_months`, `spot_usd_per_oz`; when
   smoothing, `gold_usd_per_oz` is the average and `note` names the window and
   the first/last month. `--json`, text, and `--batch` (FR26 columns).
4. Vectors: 2018-12 and a late fixture date at 10y; one year query; 1836 at
   10y (partial); same date at 5y and 20y; one negative amount. Regenerate
   via `test-vectors/regenerate.py`.

DoD: `pytest tests/python -q` green; vector diff clean.

## Phase 1b — Skill

The skill ships in the same PR as the CLI. It is a first-class surface
(spec §5a), not a note added after the flag works.

Files: `.agents/skills/gold-value-normalizer/SKILL.md`, `reference.md`,
`AGENTS.md`.

1. Replace `description` with the 494-character text in spec FR29. Do not
   edit it further without rechecking the count. The current value is 1001
   characters; the cap is 1024.
2. Body: a short "Which question" section. Spot (no flag) answers "what if I
   had bought gold that day". `--smooth 10y` (or `5y` / `20y`) answers the
   long-horizon gauge. The agent names the window, reports the averaged price,
   the months used, and the spot price beside it, and says the average is not
   CPI. Partial windows are stated (FR27–FR29).
3. `reference.md`: the equal-month trailing mean, the window end rule, and
   partial history. `AGENTS.md`: the `--smooth` invocation next to the other
   CLI commands.
4. Keep `SKILL.md` under 500 lines.

DoD: description length checked and recorded in the PR; a reader who has only
the skill can choose spot vs 10y and interpret a partial window.

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
