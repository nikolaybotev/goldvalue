# spec.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Derived from | [intent.md](intent.md) (2026-09-30) |
| Status | Draft 2 — spec review applied ([review](bc-40cb0cbd-ecec-5e31-8d21-6502bc5ca4e3)); implement with [plan.md](plan.md) |
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

#### Samples

Window length was checked by converting the same dated amounts with spot and with trailing averages, and comparing a later reading with an earlier one on one gauge. A 200-day average and a 1-year average stayed with the spot spike. A 5-year average moved part of the way. A 10-year average brought the later reading closest to the earlier one without crossing it. A 20-year average also narrowed the gap, and did more for an older break, but barely moves inside a 20-year chart.

The same windows in December 2018, when gold had been range-bound (spot $1,282 on 2018-12-31): 200-day **$1,252**, 1-year **$1,269**, 5-year **$1,240**, 10-year **$1,305**, 20-year **$879**. Everything except 20 years agrees with spot. The gauge pulls away only after a reprice.

#### Choice

Both dates of a comparison use the same window. Holding the earlier date at its spot gold weight and only smoothing the later date is not a comparison.

200 days and 1 year are not offered. On the comparison that prompted this version, **10 years** leaves the later reading closest to the earlier one without crossing it. Five years still leaves a large gap. Twenty years also narrows the gap, at the cost of a gauge that barely moves inside a 20-year chart. Default when smoothed mode is on: **10 years**. Presets: 5, 10, 20.

**D17 — Equal-month simple average, trailing.** The price at a snapshot is the
unweighted mean of the monthly gold prices in the N×12 months ending with the
snapshot's month. Each month is the v1 month resolution (mean of daily fixes
from 1968, the monthly series before). A year and a volatile year then weigh
the same. A trading-day average would let a busy decade dominate a quiet one,
and it cannot be computed on the pre-1968 series.

The window is the N×12 calendar months ending at the snapshot's month,
inclusive. A day uses that day's month. A month uses that month. A completed
year uses December. A year still in progress uses the current month. Every
month except the last is the full v1 month price. The last month uses LBMA
fixes on or before `min(snapshot day, today)` when the snapshot falls in that
month; otherwise the full month. The note says "(month to date)" when the last
month is clipped. No price after the snapshot day enters the mean. Chart x
stays the v1 midpoint of the requested period (the day, the 16th, or 2 July)
and does not move to the window's last month.

A month inside the window with no price is skipped. The mean divides by the
months that had a price. If every month is missing, a single query errors and
a batch row is skipped with a warning, same as a missing spot price.

**D18 — Partial history is shown and labeled, not hidden.** `gold_mode` is
`partial` when the closed window contains fewer than N×12 priced months. On
this series that is the start of the monthly file (1833-01): a 10-year window
is partial when it ends before 1842-12, and a 20-year window when it ends
before 1852-12. A hole in the middle is also `partial`. The note names the
requested window, the months used, and any missing months ("10-year average;
48 months, 1833-01 to 1836-12; series starts 1833-01"). `ma_years` stays the
requested width. Partial does not add amber and does not remove it. FX amber
still follows `fx_mode`. A month that used the monthly series because daily
LBMA data was not loaded appends "daily LBMA prices not loaded" once; the
value may change when the daily table arrives.

**D19 — Spot stays the default mode.** Smoothed is a sheet-wide switch, off
until the user turns it on, and the choice is remembered. Turning it on
recomputes every row. This keeps v1 answers stable.

**D20 — The chart shows the selected gauge, with spot as an optional overlay.**
Overlay is off by default. When on, spot is a thinner muted line in the
current Y-axis unit (GB, GBD, or oz), priced at the v1 spot gold price. The
tooltip lists the spot value only while the overlay is on. With it off, the
tooltip keeps the v1 fields plus the gauge's price-used note.

## 4. Functional requirements

- FR21. A control in the sheet header: `Gold price: Spot | Smoothed`, plus a
  window select (5 / 10 / 20 years) enabled only while Smoothed is on. Default
  Spot (D19). Default window 10 (D16). Persisted with the other sheet settings.
- FR22. `oz = amount_in_usd / averaged_gold_price`, `GB = oz × 1000`, `GBD = oz × 50`.
  Negative amounts keep their sign. Currency conversion to USD is unchanged and
  still uses the spot FX rate for that period, not an average of FX.
- FR23. The `Price used` cell shows the averaged price, the window, the first
  and last month included, and the month count. Partial windows use the D18 note.
- FR24. Chart y values follow the selected mode (D20). The spot overlay, when
  on, uses the v1 spot gold value for each row. Hover lists label, nominal
  amount, gauge value, and spot value. SVG/PNG export includes whichever series
  are on screen.
- FR25. The Method panel states this sentence, visible whenever the mode
  control is on screen: "Smoothed mode divides by a trailing average of monthly
  gold prices over the selected window. It is a store-of-value gauge for
  comparing snapshots across long horizons. It is not a consumer-price index
  and not a claim that gold tracks inflation." Link the existing
  historical-notes page.
- FR26. Append to the v1 export, after `fx_note`, in order: `gold_mode`,
  `ma_years`, `ma_months`, `spot_usd_per_oz`. Prices stay at 4 decimal places.
  In spot mode `gold_usd_per_oz` and `spot_usd_per_oz` are the same text, and
  `ma_years` and `ma_months` are empty. In smoothed and partial modes
  `gold_usd_per_oz` is the mean, `spot_usd_per_oz` is the v1 spot price,
  `ma_years` is 5, 10, or 20, and `ma_months` is the number of months in the
  mean. `gold_mode` is `spot`, `smoothed`, or `partial`. `effective`,
  `granularity`, and `points` stay the v1 spot resolution. `note` carries the
  window text ("10-year average; 120 months, 2016-10 to 2026-09").
  `price_source` is the single source when every month shares one, and `mixed`
  when they do not. Import ignores the four new columns. One `--smooth` flag
  covers a whole batch; `gold_mode` is per row.

## 5. Reference CLI

`goldvalue.py` gains `--smooth 5y|10y|20y` (absent = spot). It is valid only
with `--from USD`, with or without `--currency`. Any other `--from` is an
error. It applies to a single query and to every row of `--batch`.
`--price-only --smooth 10y DATE` prints the averaged price and the window
note. Text, `--json`, and `--batch` include `gold_mode`, `ma_years`,
`ma_months`, `spot_usd_per_oz`, and, when smoothing, the averaged price in
`gold_usd_per_oz`. `--vectors` gains a smoothed family on the synthetic
fixture: a flat-era date (2018-12), a post-spike date, a year query, a partial
window (1836 at 10y, which ends before 1842-12), a 5y vs 20y pair on the same
date, and one negative amount.

`packages/core` exposes the same function and passes the same vectors at 1e-9
relative on numbers and exact on the note text.

## 5a. Agent skill

`.agents/skills/gold-value-normalizer/` is the agent-facing frontend, on par
with the CLI and the SPA. A v1.2 PR that ships `--smooth` without teaching the
skill when to use it is incomplete.

- FR27. The skill classifies the question before it picks a flag.
  "What if I had bought gold that day" and "convert this timeline to goldbacks"
  stay spot (no `--smooth`). "Store of value", "moving average", "how does
  this price measure up over 10–20 years", and "how does $80K in 2018 compare
  to $200K today?" use `--smooth 10y`. The agent names the window. It does not
  switch to the average for a spot question.
- FR28. The answer reports the averaged price, the window, the months used,
  and the spot price beside it. A partial window is stated, not hidden. The
  answer says the average is not CPI and not a claim that gold tracks inflation.
- FR29. Replace `description`. The current value is 1001 characters and the
  cap is 1024, so it is rewritten, not extended. The replacement below is
  494 characters. The body stays under 500 lines. `reference.md` documents the
  equal-month trailing mean. `AGENTS.md` gains the `--smooth` command.

```
Compare dated amounts in gold units (GB = 1/1000 troy oz, GBD = 50 per oz). Spot (no --smooth) answers 'what if I had bought gold that day' and 'convert this timeline to goldbacks'. Use --smooth 10y (or 5y/20y) for 'how does $80K in 2018 compare to $200K today?', how a price measures up over 10-20 years, a store of value, or a moving average; name the window and say it is not CPI. Also converts EUR, GBP, CHF, and DEM via historical USD FX. Sources: LBMA, World Bank/NMA, BIS; cached as CSV.
```

## 6. Acceptance criteria

- AC14. The smoothed golden vectors pass in the CLI and in `packages/core` at relative 1e-9 on GB, including the 5y/20y pair, the negative amount, and the 1836 partial window. A Playwright row at 10 years matches the CLI's GB for that vector.
- AC15. While smoothed, the export's `spot_usd_per_oz` equals the pre-switch `gold_usd_per_oz` at 4 decimal places. After switching back to spot, `gold_usd_per_oz`, `troy_oz`, `GB`, `GBD`, `USD`, `note`, and `gold_mode=spot` match the pre-switch export byte for byte.
- AC16. USD `1000` / `1836` at 10 years shows `gold_mode=partial`, the D18 note for that fixture date (requested 10 years, months actually used, series starts 1833-01), and no amber marker. GBP `1000` / `1836` at 10 years is partial and still amber, with the parity tooltip.
- AC17. The Method panel shows the FR25 sentence and the historical-notes link while the mode control is on screen.
- AC18. The spot overlay is off by default and the chart has one series. Turning it on adds a second series in the current Y-axis unit; the tooltip then includes the spot value; SVG and PNG downloads contain both series. A `2019` row and a `2019-11-12` row keep their v1 x positions (2 July, and that day) in smoothed mode.
- AC19. The YAML `description` value is the FR29 text and is under 1024 characters. The body says spot for "bought gold that day" and "convert this timeline", `--smooth 10y` for the long-horizon question, and that the answer names the window, the months used, the spot price, and that the average is not CPI.

## 7. Non-goals

- A 200-day or other sub-year window.
- Exponential or weighted averages.
- A centered average (it would use prices from after the snapshot).
- Smoothing the FX rate.
- Any statement, in the UI or the docs, that the gauge measures inflation.

## 8. Open questions for review

None. D16–D20 are the design. The same-gauge table in D16 is what selected 10 years.
