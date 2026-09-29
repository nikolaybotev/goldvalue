---
name: gold-value-normalizer
description: Compare or normalize US dollar amounts from different dates by converting them into gold-denominated real-value units - goldbacks (GB, 1/1000 troy oz) or gold-backed dollars (GBD, fixed at 50 GBD per troy oz) - using the historical USD gold price for that day, month, or year. Also converts GB/GBD/oz back to USD. Use whenever the user compares dollar figures across time ("how does $80K in 2018 compare to $200K today?", "what is $X from YEAR worth now?", "is $Y today more than $Z was in YEAR?"), asks about real value, purchasing power, or inflation-adjusted equivalents of a dated dollar amount, wants a time series, table, or chart of dollar prices, wages, or amounts re-denominated in gold (or "inflation-adjusted" via gold) over time, or mentions goldbacks, GB, GBD, gold-backed dollars, "in gold terms", or "priced in gold". Also converts EUR, GBP, CHF, and DEM amounts via USD using historical BIS FX. Sources: LBMA (daily, 1968+), World Bank / NMA (monthly), BIS (FX), cached locally as CSV.
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
python3 scripts/goldvalue.py AMOUNT DATE [--from USD|GB|GBD|OZ] [--currency USD|EUR|GBP|CHF|DEM] [--to GB|GBD|OZ|USD] [--json]
```

- `AMOUNT`: plain decimals such as `1500`, `$1,500`, `1,500.50`, `2.5`; negative is allowed (put `--` before it if it contains a comma or `$`, e.g. `-- -1,500`). Exponent forms (`1e3`), `nan`, and `inf` are rejected.
- `DATE`: year `1975`; month `1975-03`, `03/1975`, `1975/03`, `"Mar 1975"`, `"March 1975"`; day `1975-03-14`, `03/14/1975`, `"14 March 1975"`, `"14 Mar 1975"`, `"March 14, 1975"`, `"Mar 14, 1975"`; or `today` / `now` / `latest`. A period that starts after today is rejected ("date is in the future").
- `--from` defaults to `USD`; use `--from GB` / `--from GBD` to convert back to dollars
- `--currency` is the currency of `AMOUNT` (default `USD`; `EUR`, `GBP`, `CHF`, `DEM`, case-insensitive). It is converted to USD at the historical FX rate first, then to gold; it needs `--from USD` (an error otherwise) and does not apply to `--price-only`. See "Other currencies" below
- `--to` limits output to one unit; omit to print GB, GBD, and oz together
- `--json` for structured output (keys below); `--price-only DATE` prints just the resolved gold price
- `--fetch-only` prefetches the gold and FX caches; `--refresh` forces a re-download; `--no-refresh` (or `GOLDVALUE_OFFLINE=1`) never uses the network
- `--batch FILE` re-denominates a whole time series in one call (see below)
- `--vectors OUT.json`, `--dates-oracle OUT.json`, `--cases FILE`: repository test tooling that writes golden vectors; not needed for normal use (see [reference.md](reference.md))

Examples:

```bash
python3 scripts/goldvalue.py 1000 1955             # year average
python3 scripts/goldvalue.py '$1,000' 1980-01-21   # exact day
python3 scripts/goldvalue.py 250000 2000 --to GBD  # only GBD
python3 scripts/goldvalue.py 100 2024-06-03 --from GB   # 100 goldbacks -> USD
python3 scripts/goldvalue.py 250000 2005-06 --currency EUR   # euros -> USD -> gold
python3 scripts/goldvalue.py 1000 1950-06 --currency GBP     # pre-1953: flagged parity rate
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
| `fx_rate`, `fx_effective`, `fx_mode`, `fx_note` | USD per one unit of `--currency`, the date or period it came from, how it was obtained (`daily`, `synthetic`, `parity`, `extrapolated`), and the explanation (empty when nothing needs saying). All `null` for USD amounts |

`input` (amount, unit, currency, period, granularity), `price_note`, and `price_points` are older aliases kept for compatibility.

## Time series, tables, and charts

For a series of dollar values over time (prices, wages, budgets, index levels), write a CSV with a `date` column and an `amount` column (any other columns pass through), then:

```bash
python3 scripts/goldvalue.py --batch series.csv > series_gold.csv   # or --batch - for stdin
```

Input header detection is case-insensitive: the date column is the first of `date`, `period`, `month`, `year`; the amount column is the first of `amount`, `usd`, `value`, `price`. A `label` column is optional. Columns produced by the batch output (`effective`, `troy_oz`, `GB`, ...) and `currency` are ignored on input, so an output file can be fed back in unchanged. If a header name repeats (case-insensitively) the first column wins; passthrough columns named like an output column are dropped.

Output columns, in order: `date, amount, currency, label, <passthrough...>, effective, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, granularity, note, fx_rate, fx_effective, fx_mode, fx_note`. `amount` echoes the input text; `currency` is `USD` (or the `--from` unit code, or the `--currency` code such as `EUR`); `label` is empty when the input has none; `fx_*` are empty for USD rows. `fx_rate` has 6 decimals. `--currency` applies to every row of the file (an imported `currency` column is ignored and regenerated). Numbers are fixed-point (GB 3 decimals, GBD 4, oz 6, USD 2, price 4), output uses LF line endings. Plot or tabulate `GB` or `GBD` against `date` for the gold-denominated view; keep `amount` alongside if the user wants nominal vs gold.

The batch stops at the first bad line (unparsable date or amount, or a future date) and names the line number. A row with no price data is skipped with a warning.

## Other currencies

`--currency EUR|GBP|CHF|DEM` follows the project's USD-routing tenet: the amount becomes USD at the historical exchange rate for the same day, month, or year, and that USD amount becomes gold at the USD benchmark. Local gold prices in other currencies are never used. Month and year queries use the ratio of means: the mean FX rate over the period, and the mean gold price over the period, each over its own observations.

FX data is the BIS daily series (1953 onward, about a week behind today), so recent dates may use a slightly stale rate and say so in `fx_note`. Every result carries `fx_mode`; report anything other than `daily` to the user, with the `fx_note` text:

| `fx_mode` | Meaning |
|-----------|---------|
| `daily` | A BIS daily observation (rolled back up to 9 days over weekends and holidays; a month or year uses the mean of its observations) |
| `synthetic` | EUR before 1999-01-04 (derived from the Deutsche Mark at 1 EUR = 1.95583 DEM) or DEM after 1998-12-31 (derived from the euro). The euro did not exist before 1999; amounts originally in francs, lire, etc. would convert differently |
| `parity` | Before the currency's first BIS observation (GBP 1953-08-10, CHF and EUR/DEM 1953-09-01): the fixed Bretton Woods par value in force, a stepwise approximation |
| `extrapolated` | Before the parity table starts (GBP 1940, CHF 1949, DEM/EUR 1948): the earliest table value, indicative only |

When several apply, the highest wins (`daily` < `synthetic` < `parity` < `extrapolated`) and `fx_note` lists all of them; for example EUR in 1950 is `parity` and the note also carries the synthetic-euro text. Sources for the parity table and the caveats are in [reference.md](reference.md) and [historical-notes.md](historical-notes.md).

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

For non-USD amounts also include the FX rate (`1 EUR = $1.2165`), its effective date or period, the `fx_mode`, and the `fx_note` whenever the mode is not `daily` or the note is not empty. Never present a `parity`, `synthetic`, or `extrapolated` result as a market rate.

For a handful of amounts, run the script once per amount (or use `--json`). For many, use `--batch`.

## Cache

- Location: `~/.cache/gold-value/` (override with `GOLD_PRICE_CACHE_DIR`)
- `lbma_daily.csv`: `date,usd_am,usd_pm` from 1968-01-02
- `monthly.csv`: `month,usd` from 1833-01
- `fx_eur.csv`, `fx_gbp.csv`, `fx_chf.csv`: `date,usd_per_unit` from the BIS (there is no DEM file: DEM is derived from EUR). Fetched on first use of a currency (all three by `--fetch-only`)
- Auto-refreshes only when a query is past the cached range and the cache is older than 12h; network failure falls back to the cached copy.
- Test hooks: `GOLDVALUE_TODAY=YYYY-MM-DD` overrides today (the `today` keyword, future-date check, month/year-to-date notes); `GOLDVALUE_OFFLINE=1` or `--no-refresh` disables all network use and errors if a cache file is missing.

## Additional resources

- Source details, provenance, licensing, and methodology caveats: [reference.md](reference.md)
- Background on the $35 era and pre-1974 simplifying assumptions (read only if the user asks): [historical-notes.md](historical-notes.md)
