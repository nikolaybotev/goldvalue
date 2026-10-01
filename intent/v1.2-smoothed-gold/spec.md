# spec.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Derived from | [intent.md](intent.md) (2026-09-30) |
| Status | Draft 1 — for review with [plan.md](plan.md). Proposed decisions are marked. |
| Stage | 2 · Design |
| Extends | [../companion-app/spec.md](../companion-app/spec.md) Draft 5. Unstated behavior is unchanged. |

## 1. Summary

v1.2 adds a sheet-wide **smoothed** gold price: a trailing average of monthly
gold prices over a long window. Each snapshot is converted with that average
instead of the spot fix, so a security's gold value is read against a
store-of-value gauge rather than against gold's latest spike. Spot remains
the default.

## 2. What the two questions compute

Both start from the same rows (amount, date, currency). They divide by a
different gold price.

| Question | Gold price used | Already shipped |
|---|---|---|
| "If I had bought gold that day instead, what is it worth now?" | Spot: the fix (or period mean) resolved by §6.4 of the v1 spec | Yes |
| "Against a long-horizon gold gauge, how expensive was this security at each snapshot?" | Trailing average of monthly gold prices ending at that snapshot | This spec |

The ounce count from the first question, times today's spot, is the dollar
value of the gold bought then. The app already shows that ounce count. v1.2
does not replace it.

## 3. Proposed decisions

**D16 — Window presets, default 10 calendar years.** Offered windows: **5, 10,
and 20 years**. Default when smoothed mode is on: **10**. No 200-day option.
A 200-day average is a trading tool; on the 2024–2026 gold run it sits on the
spike, which is the reading this gauge exists to look past.

Measured from the local LBMA cache on 2026-09-30 (monthly means, trailing,
inclusive). Spot on 2026-09-22 was $4,330; spot on 2018-12-31 was $1,282.

| Window ending | 1 year | 5 years | 10 years | 20 years |
|---|---|---|---|---|
| 2018-12 (gold had been range-bound) | $1,269 | $1,240 | $1,305 | $879 |
| 2026-09 (after the spike) | $4,453 | $2,686 | $2,078 | $1,636 |

In a flat stretch the short windows match spot. After the spike, 1 year is
already above spot, 5 years is still 62% of spot, 10 years is 48%, 20 years is
38%. Ten years is long enough to dilute one catch-up move and short enough
that a 20-year chart still has a moving gauge. Five and twenty are one click
away for a tighter or looser reading.

**D17 — Equal-month simple average, trailing.** The price at a snapshot is the
unweighted mean of the monthly gold prices in the N×12 months ending with the
snapshot's month. Each month is the v1 month resolution (mean of daily fixes
from 1968, the monthly series before). A year and a volatile year then weigh
the same. A trading-day average would let a busy decade dominate a quiet one,
and it cannot be computed on the pre-1968 series.

The window **ends** at the last day of the requested period (a day → that
day's month; a month → that month; a year → December, or the current month if
the year is still in progress). It uses no price after that month. Chart x
positions stay the v1 midpoints.

**D18 — Partial history is shown and labeled, not hidden.** If the series
starts inside the window (10 years before 1978, 20 years before 1988, anything
before 1833 plus the window), use every month that exists and set
`gold_mode = partial`. The note states the requested window and the months
actually used ("10-year average; only 48 months available, 1968-01 to
1971-12"). Partial rows are not amber. Amber stays reserved for non-market FX.

**D19 — Spot stays the default mode.** Smoothed is a sheet-wide switch, off
until the user turns it on, and the choice is remembered. Turning it on
recomputes every row. This keeps v1 answers stable.

**D20 — The chart shows the selected gauge, with spot as an optional overlay.**
Overlay is off by default. When on, spot is a thinner muted line on the same
axis, so the spike is visible next to the gauge. One tooltip lists both.

## 4. Functional requirements

- FR21. A control in the sheet header: `Gold price: Spot | Smoothed`, plus a
  window select (5 / 10 / 20 years) enabled only while Smoothed is on. Default
  Spot (D19). Default window 10 (D16). Persisted with the other sheet settings.
- FR22. In Smoothed mode, GB, GBD, and troy oz are `amount_in_usd / averaged_gold_price`
  using the same unit factors as v1 (1000 GB/oz, 50 GBD/oz). Currency conversion
  to USD is unchanged and still uses the spot FX rate for that period, not an
  average of FX.
- FR23. The `Price used` cell shows the averaged price, the window, the first
  and last month included, and the month count. Partial windows use the D18 note.
- FR24. Chart y values follow the selected mode (D20). The spot overlay, when
  on, uses the v1 spot gold value for each row. Hover lists label, nominal
  amount, gauge value, and spot value. SVG/PNG export includes whichever series
  are on screen.
- FR25. The Method panel states, in substance: the smoothed price is a trailing
  average over the selected window; it is a store-of-value gauge for comparing
  snapshots across long horizons; it is not a consumer-price index and not a
  claim that gold tracks inflation. Link the existing historical-notes page.
- FR26. CSV export adds `gold_mode` (`spot` | `smoothed`), `ma_years` (empty
  when spot), `ma_months` (count used), and `spot_usd_per_oz` (the v1 spot
  price, always present). When smoothed, `gold_usd_per_oz` is the averaged
  price. Import ignores these columns the way it ignores other computed columns.
  The CLI `--batch` schema gains the same columns.

## 5. Reference CLI

`goldvalue.py` gains `--smooth 5y|10y|20y` (absent = spot). It applies to a
single query and to `--batch`. Text, `--json`, and `--batch` include
`gold_mode`, `ma_years`, `ma_months`, `spot_usd_per_oz`, and the averaged
price in `gold_usd_per_oz` when smoothing. `--vectors` gains a smoothed family:
a flat-era date (2018-12), a post-spike date, a year query, a partial window
(1970 with 10y), and a 5y vs 20y pair on the same date. Vectors stay on the
synthetic fixture.

`packages/core` exposes the same function and passes the same vectors at 1e-9
relative on numbers and exact on the note text.

## 6. Acceptance criteria

- AC14. With Smoothed / 10 years, a row's GB equals `goldvalue.py AMOUNT DATE --smooth 10y` on the synthetic fixture.
- AC15. Switching Spot → Smoothed recomputes every row; switching back restores the spot values bit-for-bit in the export's `spot_usd_per_oz` column.
- AC16. A row whose window starts before the fixture's first month shows `gold_mode=partial` behavior: a value, the D18 note, and no amber FX marker (use a USD row).
- AC17. The Method panel contains the FR25 statement whenever Smoothed is available.
- AC18. With the spot overlay on, the chart has two series and the SVG download contains both. With it off, one series.

## 7. Non-goals

- A 200-day or other sub-year window.
- Exponential or weighted averages.
- A centered average (it would use prices from after the snapshot).
- Smoothing the FX rate.
- Any statement, in the UI or the docs, that the gauge measures inflation.

## 8. Open questions for review

- Q1. Confirm D16's default of 10 years and the 5/10/20 presets. (The measurements in D16 are the evidence.)
- Q2. Confirm D17's equal-month weighting, as against an average of trading-day fixes.
- Q3. Confirm D20: spot overlay off by default, rather than always showing both.
