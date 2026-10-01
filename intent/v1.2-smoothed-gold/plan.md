# plan.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Implements | [spec.md](spec.md) Draft 2 |
| Status | Draft 3 — plan review applied. Two PRs, then the tag. |
| Stage | 3 · Build |

Spec wins. Python stays stdlib. Vectors stay on the synthetic fixture. No LBMA
file is committed (D15). Python and TypeScript schema changes land in the
**same PR**, because CI regenerates vectors and then runs `pnpm test`.

## PR A — CLI, core, skill, CSV contract

Files: `goldvalue.py`, `tests/python/`, `packages/core/src/{table,smooth,convert,csv}.ts`,
`packages/core/test/`, `test-vectors/` (cases, regenerate, gold vectors, batch
outputs), `SKILL.md`, `reference.md`, `AGENTS.md`, `apps/web/test/csv-io.test.ts`.

1. **Month prices, separate from the file series.** On `GoldTable`, a
   `month_price` map of full-month means: daily `fmean` when the month has
   LBMA fixes, else the monthly-file value. Fill it in `_load` / the
   TypeScript constructor. Do not write into `monthly` / `monthlyByMonth`.
   The clipped last month is computed per query from daily fixes, not stored
   as that month's only price.
2. **`--smooth 5y\|10y\|20y`.** Valid only with `--from USD` (error otherwise),
   with or without `--currency`. FX stays the spot rate for the period (FR22).
   Applies to one query and to every `--batch` row. `--price-only --smooth 10y DATE`
   prints the mean and the note.
3. **Window (D17).** N×12 months ending at the snapshot's month. A day uses
   that day's month; a month uses that month; a completed year uses December;
   a year still in progress uses the current month. Every month except the
   last is the full month price. The last month uses fixes on or before
   `min(snapshot day, today)` only when the snapshot falls in that month;
   otherwise the full month. Note gains `(month to date)` only when clipped.
4. **Mode.** `gold_mode` is `spot`, `smoothed`, or `partial`. `partial` when
   fewer than N×12 months had a price: series start (5y before 1837-12, 10y
   before 1842-12, 20y before 1852-12) or a hole. Skip missing months and
   divide by the months that had a price. Zero months: error on a single
   query, skip the batch row with a warning. `ma_years` is 5, 10, or 20.
   `ma_months` is the count in the mean. In spot mode both are empty and
   `spot_usd_per_oz` equals `gold_usd_per_oz`.
5. **Notes, exact.** Full window: `10-year average; 120 months, 2016-10 to 2026-09`.
   Partial on this fixture: `10-year average; 48 months, 1833-01 to 1836-12; series starts 1833-01`.
   `price_source` is the one shared source, or `mixed` when months differ
   (LBMA vs World Bank vs Timothy Green / NMA). `effective`, `granularity`,
   and `points` stay the v1 spot resolution.
6. **CSV.** Append after `fx_note`, in order: `gold_mode`, `ma_years`,
   `ma_months`, `spot_usd_per_oz`. Prices at 4 decimal places. Import ignores
   the four columns. Update `COMPUTED_COLUMNS` and `exportCsv` together.
7. **Vectors.** 2018-12 and a late fixture date at 10y; one year query; 1836
   at 10y only (the partial); the 5y/20y pair on 2018-12 (full history); one
   negative amount; one window that crosses 1960 or 1968 and expects
   `mixed`. Regenerate with `python3 test-vectors/regenerate.py`.
8. **Hole test.** A Python test and a core test build a tiny table with an
   interior hole and a fully empty window. Do not use the fixture for this.
   Lock the hole note there.
9. **Not-loaded path (TypeScript only).** When the daily table is empty and
   the window includes a month on or after 1968-01, append
   `daily LBMA prices not loaded` once. A core test covers it. Python always
   has `lbma_daily.csv` or it errors, so Python does not emit that phrase.
10. **Skill, after the flag works.** Description is the FR29 text, byte for
    byte (494 characters). Body: "Which question" with the FR27 phrases,
    including "convert this timeline to goldbacks" for spot and the
    inflation disclaimer. Update "Reporting results", "Price resolution
    rules", the batch column list, and the examples. `reference.md` documents
    the mean. `AGENTS.md` updates the CLI line, the batch schema, the
    regenerate invocation, the `convert` keys, and the CSV-export line, and
    states that this schema change is one PR.
11. Negative amounts keep their sign.

DoD, all green: `python3 -m pytest tests/python -q`; `python3 test-vectors/regenerate.py` with a clean diff; `pnpm --filter @goldvalue/core test`; `pnpm --filter @goldvalue/web test`; `pnpm typecheck`.

### Deviations

- `apps/web/e2e/fx.spec.ts` asserts the export header byte for byte. PR A appends `gold_mode`, `ma_years`, `ma_months`, `spot_usd_per_oz` to every export, including spot, and CI runs Playwright, so that assertion lists the four columns. No smooth UI (that is PR B).
- `apps/web/test/compute.test.ts` replays every USD golden vector through the spot sheet. Smoothed cases are skipped there until PR B passes the window into `computeRow`.
- An empty smoothed window errors with `no gold price data for the N-year span ending YYYY-MM`. The word is `span` because `packages/core` source is scanned for the DOM global `window`. Python uses the same sentence.

## PR B — Sheet, chart, copy

Files: `apps/web/src/**`, `apps/web/e2e/smooth.spec.ts`, `apps/web/e2e/download.spec.ts`.

1. Header control (FR21): Spot | Smoothed, window 5/10/20 enabled only while
   Smoothed is on. Default Spot and 10 (D19, D16). Persist in the settings
   blob, versioned the way `loadSettings` already versions `v`.
2. `results` in `sheet-store.ts` includes mode and window in the cache key.
   A currency-only key will not recompute. Non-USD rows stay enabled: spot FX,
   then the averaged gold price (FR22).
3. `Price used` shows the window, the span, and the month count (FR23).
   Partial does not add or remove amber.
4. Chart y is the gauge. Do not change `midpoint`. Spot overlay off by
   default (D20), thinner muted line, current Y-axis unit. Reuse
   `INLINED_PROPERTIES` in `apps/web/src/export/chart-image.ts` (`stroke`,
   `stroke-width`, `stroke-opacity`, `opacity`). Tooltip lists spot only
   while the overlay is on.
5. Method panel shows the FR25 sentence and the historical-notes link
   whenever the mode control is on screen (AC17).
6. `e2e/smooth.spec.ts`, with the existing clock pin and LBMA stubs:
   - AC14: a 10y row's GB equals the CLI vector.
   - AC15: spot round-trip byte for byte, as specified.
   - AC16: USD `1000` / `1836` at 10y is partial, shows the D18 note, no amber.
     GBP `1000` / `1836` at 10y is partial and still amber, with the parity tooltip.
   - AC18: overlay off by default; on adds a second series; tooltip includes
     spot; SVG download contains both (`download.spec.ts`). A `2019` point has
     `data-date=2019-07-02` and a `2019-11-12` point has `data-date=2019-11-12`.

DoD: `pnpm test:e2e` and `pnpm size` green. Push to `main` runs
`deploy-pages.yml`. Tag `v1.2.0` only after that deploy is serving the
control. Confirm with `curl` of the page and a production smoke load.

## Out of scope

200-day averages, EMA, centered windows, smoothed FX, CPI.
