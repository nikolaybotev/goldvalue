---
name: gold-value-normalizer
description: Compare or normalize US dollar amounts from different dates by converting them into gold-denominated real-value units - goldbacks (GB, 1/1000 troy oz) or gold-backed dollars (GBD, fixed at 50 GBD per troy oz) - using the historical USD gold price for that day, month, or year. Also converts GB/GBD/oz back to USD. Use whenever the user compares dollar figures across time ("how does $80K in 2018 compare to $200K today?", "what is $X from YEAR worth now?", "is $Y today more than $Z was in YEAR?"), asks about real value, purchasing power, or inflation-adjusted equivalents of a dated dollar amount, wants a time series, table, or chart of dollar prices, wages, or amounts re-denominated in gold (or "inflation-adjusted" via gold) over time, or mentions goldbacks, GB, GBD, gold-backed dollars, "in gold terms", or "priced in gold". Prices come from LBMA (daily, 1968+) and World Bank / NMA series (monthly, 1833+), cached locally as CSV on first use.
---

# Gold Value Normalizer

Convert dated USD amounts into gold units so values from different eras are comparable.

## Units

| Unit | Definition | Formula |
|------|-----------|---------|
| `GB` (goldback) | 1/1000 troy oz of gold | `GB = USD / gold_price * 1000` |
| `GBD` (gold-backed dollar) | 1/50 troy oz; 50 GBD per troy oz | `GBD = USD / gold_price * 50` |
| `OZ` | troy ounce of gold | `OZ = USD / gold_price` |

`GB` is always shorthand for goldback. `gold_price` is the USD price of one troy ounce on the requested date.

## Run the script

Execute `scripts/goldvalue.py` (Python 3.9+, standard library only). First run downloads and caches the price tables; later runs are offline.

```bash
python3 scripts/goldvalue.py AMOUNT DATE [--from USD|GB|GBD|OZ] [--to GB|GBD|OZ|USD] [--json]
```

- `AMOUNT`: `1500`, `$1,500`, `2.5`
- `DATE`: `1975` (year), `1975-03` or `"Mar 1975"` (month), `1975-03-14` (day), `today`
- `--from` defaults to `USD`; use `--from GB` / `--from GBD` to convert back to dollars
- `--to` limits output to one unit; omit to print GB, GBD, and oz together
- `--json` for structured output; `--price-only DATE` prints just the resolved gold price
- `--fetch-only` prefetches the cache; `--refresh` forces a re-download
- `--batch FILE` re-denominates a whole time series in one call (see below)

Examples:

```bash
python3 scripts/goldvalue.py 1000 1955             # year average
python3 scripts/goldvalue.py '$1,000' 1980-01-21   # exact day
python3 scripts/goldvalue.py 250000 2000 --to GBD  # only GBD
python3 scripts/goldvalue.py 100 2024-06-03 --from GB   # 100 goldbacks -> USD
```

## Time series, tables, and charts

For a series of dollar values over time (prices, wages, budgets, index levels), write a CSV with a `date` column and an `amount` column (any other columns pass through), then:

```bash
python3 scripts/goldvalue.py --batch series.csv > series_gold.csv   # or --batch - for stdin
```

Output columns: `date, effective, amount_usd, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, <passthrough...>`. Plot or tabulate `GB` or `GBD` against `date` for the gold-denominated view; keep `amount_usd` alongside if the user wants nominal vs gold.

## Price resolution rules

The script applies these automatically; state which one applied when reporting results.

| Input | Data used |
|-------|-----------|
| Day, 1968-01-02 or later | LBMA fix for that day (PM; AM if PM missing). Weekends/holidays roll back to the previous trading day. |
| Day, before 1968 | Monthly series value for that month (no daily data exists). |
| Month | Average of all LBMA daily fixes in the month; pre-1968 uses the monthly series value. |
| Year | Average of all LBMA daily fixes in the year; pre-1968 averages the 12 monthly values. Current year is year-to-date. |

Pre-1960 monthly values are annual averages repeated for each month. Before 1971 the dollar was pegged near $35/oz, so early-era conversions are close to fixed ratios.

## Reporting results

**State the method up front.** When the user asked about purchasing power, real value, or inflation adjustment without naming gold, say in one sentence that the comparison is denominated in gold (goldbacks / GBD via the historical gold price), not CPI or another price index, and that gold-based and CPI-based answers can differ substantially. Offer a CPI comparison as an alternative if it would be useful; do not silently present gold terms as "inflation-adjusted dollars".

Always include: the amount, the effective date/period, the gold price used, the source, and any granularity note (e.g. "used previous fix from 1980-01-18", "average of 252 LBMA daily fixes"). Example:

```
$1,000.00 in 1980-01-21 @ $850.00/troy oz (LBMA PM fix)
  = 1,176.47 GB  |  58.82 GBD  |  1.1765 troy oz
```

For a handful of amounts, run the script once per amount (or use `--json`). For many, use `--batch`.

## Cache

- Location: `~/.cache/gold-value/` (override with `GOLD_PRICE_CACHE_DIR`)
- `lbma_daily.csv`: `date,usd_am,usd_pm` from 1968-01-02
- `monthly.csv`: `month,usd` from 1833-01
- Auto-refreshes only when a query is past the cached range and the cache is older than 12h; network failure falls back to the cached copy.

## Additional resources

- Source details, provenance, licensing, and methodology caveats: [reference.md](reference.md)
- Background on the $35 era and pre-1974 simplifying assumptions (read only if the user asks): [historical-notes.md](historical-notes.md)
