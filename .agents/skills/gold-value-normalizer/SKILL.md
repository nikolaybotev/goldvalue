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

- `AMOUNT`: plain decimals such as `1500`, `$1,500`, `1,500.50`, `2.5`; negative is allowed (put `--` before it if it contains a comma or `$`, e.g. `-- -1,500`). Exponent forms (`1e3`), `nan`, and `inf` are rejected.
- `DATE`: year `1975`; month `1975-03`, `03/1975`, `1975/03`, `"Mar 1975"`, `"March 1975"`; day `1975-03-14`, `03/14/1975`, `"14 March 1975"`, `"14 Mar 1975"`, `"March 14, 1975"`, `"Mar 14, 1975"`; or `today` / `now` / `latest`. A period that starts after today is rejected ("date is in the future").
- `--from` defaults to `USD`; use `--from GB` / `--from GBD` to convert back to dollars
- `--to` limits output to one unit; omit to print GB, GBD, and oz together
- `--json` for structured output (keys below); `--price-only DATE` prints just the resolved gold price
- `--fetch-only` prefetches the cache; `--refresh` forces a re-download; `--no-refresh` (or `GOLDVALUE_OFFLINE=1`) never uses the network
- `--batch FILE` re-denominates a whole time series in one call (see below)

Examples:

```bash
python3 scripts/goldvalue.py 1000 1955             # year average
python3 scripts/goldvalue.py '$1,000' 1980-01-21   # exact day
python3 scripts/goldvalue.py 250000 2000 --to GBD  # only GBD
python3 scripts/goldvalue.py 100 2024-06-03 --from GB   # 100 goldbacks -> USD
```

## JSON output

`--json` prints one object. Use these top-level keys (same names as the batch CSV):

| Key | Meaning |
|-----|---------|
| `effective` | Date or period the price came from (`1980-01-21`, `1975-03`, `1975`) |
| `granularity` | `day`, `month`, or `year` |
| `points` | Number of fixes or monthly values averaged (1 for a single fix) |
| `gold_usd_per_oz` | USD per troy oz used (full precision) |
| `price_source`, `note` | Source label and the human-readable resolution note |
| `troy_oz`, `GB`, `GBD`, `USD` | The converted amount in every unit |
| `fx_rate`, `fx_effective`, `fx_mode`, `fx_note` | Always `null` for now (reserved for multi-currency) |

`input`, `price_note`, and `price_points` are older aliases kept for compatibility.

## Time series, tables, and charts

For a series of dollar values over time (prices, wages, budgets, index levels), write a CSV with a `date` column and an `amount` column (any other columns pass through), then:

```bash
python3 scripts/goldvalue.py --batch series.csv > series_gold.csv   # or --batch - for stdin
```

Input header detection is case-insensitive: the date column is the first of `date`, `period`, `month`, `year`; the amount column is the first of `amount`, `usd`, `value`, `price`. A `label` column is optional. Columns produced by the batch output (`effective`, `troy_oz`, `GB`, ...) and `currency` are ignored on input, so an output file can be fed back in unchanged.

Output columns, in order: `date, amount, currency, label, <passthrough...>, effective, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, granularity, note, fx_rate, fx_effective, fx_mode, fx_note`. `amount` echoes the input text; `currency` is `USD` (or the `--from` unit code); `label` is empty when the input has none; `fx_*` are empty for now. Numbers are fixed-point (GB 3 decimals, GBD 4, oz 6, USD 2, price 4), output uses LF line endings. Plot or tabulate `GB` or `GBD` against `date` for the gold-denominated view; keep `amount` alongside if the user wants nominal vs gold.

The batch stops at the first bad line (unparsable date or amount, or a future date) and names the line number. A row with no price data is skipped with a warning.

## Price resolution rules

The script applies these automatically; state which one applied when reporting results.

| Input | Data used |
|-------|-----------|
| Day, 1968-01-02 or later | LBMA fix for that day (PM; AM if PM missing). Weekends/holidays roll back to the most recent fix up to 9 days earlier; beyond that the monthly series value is used (the note says so). A day after the latest fix uses the latest fix. |
| Day, before 1968 | Monthly series value for that month (no daily data exists). |
| Month | Average of all LBMA daily fixes in the month; pre-1968 uses the monthly series value. The current month is month-to-date. |
| Year | Average of all LBMA daily fixes in the year; pre-1968 averages the 12 monthly values. The current year is year-to-date. |

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
- Test hooks: `GOLDVALUE_TODAY=YYYY-MM-DD` overrides today (the `today` keyword, future-date check, month/year-to-date notes); `GOLDVALUE_OFFLINE=1` or `--no-refresh` disables all network use and errors if a cache file is missing.

## Additional resources

- Source details, provenance, licensing, and methodology caveats: [reference.md](reference.md)
- Background on the $35 era and pre-1974 simplifying assumptions (read only if the user asks): [historical-notes.md](historical-notes.md)
