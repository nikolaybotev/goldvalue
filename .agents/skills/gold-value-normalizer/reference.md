# Gold price sources and methodology

## Sources

### LBMA Gold Price (daily, 1968-present)

- URLs: `https://prices.lbma.org.uk/json/gold_pm.json`, `https://prices.lbma.org.uk/json/gold_am.json`
- Publisher: London Bullion Market Association. The LBMA Gold Price (formerly the London Gold Fix) is the global benchmark for physical gold.
- Coverage: AM fix from 1968-01-02; PM fix from 1968-04-01. JSON rows are `{"d": "YYYY-MM-DD", "v": [USD, GBP, EUR]}`; the script keeps only USD.
- The script prefers the PM fix and falls back to AM when PM is null (Jan-Mar 1968 and occasional gaps).
- Terms: free for personal/non-commercial use; redistribution of the data is governed by LBMA's terms.

### Monthly USD gold price (1833-present)

- URL: `https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv` (Open Knowledge "core" datasets; mirrored at https://datahub.io/core/gold-prices)
- Columns: `Date` (`YYYY-MM`), `Price` (USD per troy oz)
- Provenance, per the package's `datapackage.json` and README:
  - 1960-present: World Bank Commodity Markets "Pink Sheet" monthly averages
  - 1833-1959: Timothy Green's Historical Gold Price Table, published by the National Mining Association (annual averages; each month of a year carries the same value)
- License: Open Data Commons Public Domain Dedication and License (PDDL 1.0)
- Updated daily by GitHub Actions.

### BIS daily exchange rates (1953-present; EUR, GBP, CHF, DEM)

- API: `https://stats.bis.org/api/v1/data/WS_XRU/D.{AREA}.{CCY}.A?format=csv` (BIS Data Portal, dataset WS_XRU, "Exchange rates against USD"). The answer is a multi-column CSV; the script reads `TIME_PERIOD` and `OBS_VALUE`. Series used: `D.GB.GBP` (first valid date 1953-08-10), `D.CH.CHF` (1953-09-01), `D.DE.EUR` (1953-09-01). Rows before the first valid date carry `NaN` and are skipped.
- **Quote convention: units of currency per USD** (GBP 0.603189 and EUR 0.848248 on 1999-01-04; CHF 4.286589 on 1953-09-01). The fetcher stores the inverse as `usd_per_unit`, formatted with six significant digits (`format(1/quote, ".6g")`), which keeps each file under the 110 KB gzip budget (eight decimals would be about 127 KB for GBP).
- **One series serves EUR and DEM.** `D.DE.EUR` is Germany's history restated in euros at the fixed conversion rate, so before 1999 it is the Deutsche Mark divided by 1.95583 (1990-06-01: 0.86587 EUR per USD = 1.6935 DEM per USD) and from 1999 it equals the ECB reference rate. There is no BIS `DEM` series (404). `usd_per_dem = usd_per_eur / 1.95583`. The euro-area aggregate `D.XM.EUR` (ECB/ECU-based, starts 1974) is deliberately not used.
- Latest observation lags about a week; observations exist on some weekends but not on holidays; a 10-day gap exists in August 1971.
- CORS: origin-reflecting. Terms: free with attribution ("BIS Data Portal, exchange rates against USD"); the CSVs are redistributed with the site as `fx_eur.csv`, `fx_gbp.csv`, `fx_chf.csv`.
- Cross-checks (2026-09-29): BIS `D.DE.EUR` against the ECB reference rate (`https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata`, USD per EUR) over the 7,098 common days from 1999-01-04: maximum relative difference 7.8e-7 (BIS carries the ECB rate). FRED `DEXUSUK` on 1999-01-04 is 1.6581 USD per GBP against BIS 1.6579; FRED `DEXSZUS` is 1.3666 CHF per USD against BIS 1.3714 (0.35 percent, different observation times). FRED is not used by the script.
- Sizes of the real files on 2026-09-29 (gzip level 9): `fx_gbp.csv` 91,239 bytes (18,883 rows), `fx_chf.csv` 97,567 (18,873), `fx_eur.csv` 89,324 (18,861); budget 110,000.

### Sources evaluated and not used

- FRED `GOLDAMGBD228NLBM` / `GOLDPMGBD228NLBM`: removed from FRED; returns 404.
- Bundesbank gold series: 1968+ only, no advantage over LBMA.
- Kitco / goldprice.org historical tables: HTML scraping, no stable CSV endpoint.
- LBMA GBP and EUR gold fixes: the tenet is USD routing (below); local-currency gold fixes are never used.
- xe.com: no free historical API; scraping violates its terms.
- FRED `DEXUSUK`, `DEXSZUS`: 1971 onward only, quote conventions differ per series; cross-check only.

## Resolution methodology

| Query | 1968-01-02 onward | Before 1968 |
|-------|-------------------|-------------|
| Exact day | LBMA fix that day; if none (weekend/holiday), most recent prior fix up to 9 calendar days earlier; if there is none, the monthly value for that month (note: "no LBMA fix within 9 days before D; used the monthly price"). A day after the latest fix uses the latest fix (within 9 days: previous-fix note; beyond: "requested date is after the latest available fix") | Monthly value for that month |
| Month | Arithmetic mean of LBMA daily fixes in the month; the current month says "(month to date)" | Monthly series value |
| Year | Arithmetic mean of LBMA daily fixes in the year; the current year says "(year to date)" | Mean of the 12 monthly values |

Averages are simple (unweighted) means of trading-day fixes, which matches how LBMA and the World Bank publish their own monthly averages.

## Currency conversion (USD routing)

**Tenet.** A non-USD amount is converted to USD at the historical exchange rate for the same period, and that USD amount is converted to gold at the USD benchmark. Gold prices in other currencies (LBMA GBP/EUR fixes, local dealer prices) are never used, so every currency is normalised to one bullion price. Curated currencies: USD, EUR, GBP, CHF, DEM. `--currency` needs `--from USD`.

**FX resolution** (implemented by `resolve_fx`, same granularity as the query, resolved independently of gold):

| Query | Rule |
|-------|------|
| Day | The BIS observation on that day; otherwise the most recent one up to 9 calendar days earlier (`fx_note` says so; rates older than 3 days after the last observation also say "BIS data lags about a week"). After the last observation by more than 9 days: the last observation with a note. Before the currency's first observation: parity (below) |
| Month, year | Arithmetic mean of the observations in the period (ratio of means: `usd = amount x mean(usd_per_unit)`, then `oz = usd / mean(gold)`). A period that straddles the first observation uses the mean of the observations and says so. A period wholly before the first observation uses the parity in force at its midpoint (the 16th, or 2 July). A period ending after the last observation notes the lag when the gap exceeds 3 days |

`fx_effective` is the observation date (day queries), the period (`2005-06`, `2005`), or the effective-from date of the parity row. Gold and FX holidays differ, so `effective` and `fx_effective` can differ. `fx_rate` is USD per one unit of the currency; `USD = amount x fx_rate`.

**`fx_mode`** (highest wins; `fx_note` lists every applicable explanation, mode-defining text first):

| Value | When | Precedence |
|-------|------|-----------|
| `daily` | BIS observation(s); DEM before 1999 is derived from the observation but is still `daily` | 0 |
| `synthetic` | EUR when any observation used is before 1999-01-04; DEM when any observation used is after 1998-12-31 (decided by the dates actually used, whatever the data source) | 1 |
| `parity` | Before the currency's first BIS observation, at or after the first parity-table row | 2 |
| `extrapolated` | Before the parity table's first row (earliest row used) | 3 |

Synthetic-euro text (verbatim, spec D10): "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche Mark at the fixed conversion rate 1 € = 1.95583 DM. Amounts originally in other legacy currencies (francs, lire, …) would differ." Example precedence: EUR in 1950 is `parity` and its note also carries the synthetic text. USD rows have all four `fx_*` fields empty and no marker in the app.

**Fixed-parity table** (`PARITY_TABLE`, USD per unit; used only before each currency's first BIS observation; the 1961 and 1967-1969 revaluations and devaluations appear in the daily data). EUR before 1953-09-01 is the DEM parity times 1.95583.

| Currency | From | USD per unit | Event | Verification (2026-09-29) |
|---|---|---|---|---|
| GBP | 1940-01-01 | 4.03 | wartime peg | Value verified: the pound was worth $4.03 until the devaluation ([Wikipedia: 1949 sterling devaluation](https://en.wikipedia.org/wiki/1949_sterling_devaluation), [Guardian Century, 19 Sep 1949](https://www.theguardian.com/century/1940-1949/Story/0,,105127,00.html), [Foreign Affairs, Jan 1950](https://www.foreignaffairs.com/articles/europe/1950-01-01/devaluation-and-european-recovery)). The start date 1940-01-01 is the table's boundary, not a sourced effective date (the rate dates from 1939): **unverified** as a date |
| GBP | 1949-09-18 | 2.80 | devaluation | Verified: same sources (announced Sunday 18 Sep 1949, in force from the 19th); BIS's first daily GBP observation, 2.785 on 1953-08-10, is consistent |
| CHF | 1949-01-01 | 1 / 4.37282 | Swiss gold parity | Verified by derivation: the SNB gold parity of 0.2032258 g (63/310 g; Federal Council decree of 27 Sep 1936, Federal Coinage Act of 17 Dec 1952, see the [Bundesbank exchange rate statistics, Feb 2010, footnotes 25 and 28](https://www.bundesbank.de/resource/blob/709810/b4fc806f72fbe67e3d362c72de631707/mL/2010-02-exchange-rate-statistics-data.pdf)) against 0.888671 g per dollar at $35/oz gives 4.372824 CHF per USD, unchanged until the 9 May 1971 revaluation ([SNB chronicle](https://www.snb.ch/en/the-snb/organisation/history/geld-und-waehrungspolitische-chronik)). Switzerland was not an IMF member, so this is the Swiss legal parity, not an IMF par; the franc traded inside a band around it (BIS 1953-09-01: 4.2866). The start date 1949-01-01 is the table's boundary (the parity dates from 1936): **unverified** as a date |
| DEM | 1948-06-21 | 1 / 3.33 | currency reform | Verified: DM 3.33 per dollar (30 US cents) when the mark was introduced ([Bundesbank, 1948 reform](https://www.bundesbank.de/en/press/contributions/the-economic-and-currency-reform-of-1948-the-basis-for-stable-money-915302) for 21 June; [Emminger, Princeton IES E122](https://ies.princeton.edu/pdf/E122.pdf) for the rate; the Bundesbank Monatsbericht of Sep 1949 says the provisional 30-cent rate was fixed by the Allied military governments on 1 May 1948) |
| DEM | 1949-09-28 | 1 / 4.20 | devaluation | Value verified: DM 4.20 per dollar = 23.8095 US cents (Emminger, Princeton IES E122; [Bundesbank Monatsbericht, Sep 1949](https://www.bundesbank.de/resource/blob/690230/8b8758d3833f7e125aecdeda727a0e79/472B63F073F071307366337C94F8C870/1949-08-monatsbericht-data.pdf); [FRUS 1949 vol. III, doc. 212](https://history.state.gov/historicaldocuments/frus1949v03/d212)). **Date discrepancy:** the sources give the rate as effective from 19 Sep 1949, 0:00, announced on 28-29 Sep; the table keeps 1949-09-28 (the spec value), so 19-27 Sep 1949 use 3.33. BIS's first EUR observation, 2.147426 EUR per USD, times 1.95583 is exactly 4.2000 DEM |
| EUR | before 1953-09-01 | DEM parity x 1.95583 | via DEM | 1 EUR = 1.95583 DEM verified ([Wikipedia: Deutsche Mark](https://en.wikipedia.org/wiki/Deutsche_Mark), conversion table) |

The 1.95583 factor is irrevocable; the ECU (the euro's 1:1 predecessor basket) is not used. Dates before the first row (GBP before 1940, CHF before 1949, DEM/EUR before 1948-06-21) use the earliest row and are `extrapolated`; pre-1940 sterling was about $4.87 on the gold standard until 1931 and floated in the 1930s, so those values are indicative only.

## Caveats

- **Bretton Woods era (1950-1971):** the official US price was $35/oz. The London free market traded within a few percent of that until 1968, when the two-tier system began. Conversions in this era are therefore near-constant (~28.5 oz per $1,000). Premium/black markets diverged materially at times; see [historical-notes.md](historical-notes.md).
- **Pre-1960 granularity:** only annual averages exist, so a "monthly" query for 1955 returns the 1955 annual figure.
- **1968 Jan-Mar:** only AM fixes exist; the script uses them.
- **Latest date:** LBMA publishes after the London PM fix (~15:00 London). Querying `today` before that returns the previous fix and says so.
- **Goldback definition:** the physical Goldback note contains 1/1000 troy oz of 24k gold. Its retail exchange rate includes a manufacturing premium; this skill uses the pure metal content only.
- **GBD** is a hypothetical unit defined here as 1/50 troy oz. It is not a real currency.

## Cache format

`~/.cache/gold-value/lbma_daily.csv`

```
date,usd_am,usd_pm
1968-01-02,35.18,
1980-01-21,843.00,850.00
```

`~/.cache/gold-value/monthly.csv`

```
month,usd
1950-01,34.720
1980-01,675.000
```

`~/.cache/gold-value/fx_eur.csv`, `fx_gbp.csv`, `fx_chf.csv` (there is no DEM file)

```
date,usd_per_unit
1953-09-01,0.465674
1999-01-04,1.1789
```

Delete the directory or run with `--refresh` to rebuild. A query with `--currency` fetches only the FX file it needs (DEM uses `fx_eur.csv`); `--fetch-only` fetches all three; a stale FX file is refreshed like the gold tables when a query reaches past its last observation.

## Input grammar (contract for ports)

- **Dates** (`parse_period`): `YYYY`; `YYYY-MM`, `MM/YYYY`, `YYYY/MM`, `Mon YYYY`, `Month YYYY`; `YYYY-MM-DD`, `MM/DD/YYYY`, `D Month YYYY`, `D Mon YYYY`, `Month D, YYYY`, `Mon D, YYYY`; `today`/`now`/`latest`. The parser uses Python `strptime`, so it is lenient: unpadded numbers (`2024-6-3`), case-insensitive month names, repeated spaces, surrounding whitespace. Non-ASCII input is rejected. "Today" is the local calendar date unless `GOLDVALUE_TODAY` is set. A period whose first day is after today is an error.
- **Amounts** (`parse_amount`): after removing `,`, `$`, `_` and surrounding whitespace, a plain decimal (`[+-]digits[.digits]` or `.digits`). Exponent forms, `nan`, `inf`, and values that overflow a double are rejected (decision: spec FR3 lists only plain decimals).

## Output contract

`--json` object (top-level keys): `input` (`amount`, `unit`, `currency`, `period`, `granularity`; legacy), `effective`, `granularity`, `points`, `gold_usd_per_oz` (unrounded), `price_source`, `note`, `troy_oz`, `GB`, `GBD`, `USD`, `fx_rate` (USD per unit, unrounded), `fx_effective`, `fx_mode`, `fx_note` (all four `null` for USD amounts; `fx_note` is `""` for a clean daily rate), and the legacy aliases `price_note`, `price_points`. `--price-only --json` returns `gold_usd_per_oz`, `price_source`, `price`, `source`, `granularity`, `effective`, `points`, `note`.

`--batch` CSV (spec FR15), in order: `date, amount, currency, label, <passthrough columns>, effective, gold_usd_per_oz, troy_oz, GB, GBD, USD, price_source, granularity, note, fx_rate, fx_effective, fx_mode, fx_note`.

- Input: date column = first of `date`, `period`, `month`, `year`; amount column = first of `amount`, `usd`, `value`, `price` (case-insensitive). Computed columns above and `currency` are dropped on input. `USD` is both an amount alias and a computed column, so it is treated as computed only when the header also contains `troy_oz` or `gold_usd_per_oz` (an exported file). A `label` column is optional and always emitted. If a header name repeats (trimmed, case-insensitive) the first column wins and later ones are dropped. Passthrough columns whose names equal any output column name (fixed or computed, case-insensitive) are dropped so the output header never repeats a name (the "dedupe rule"; the spec does not define it, this is the project's reading).
- `amount` echoes the input token; `date` echoes the input date token; `currency` is `USD`, the `--currency` code (`EUR`, `GBP`, `CHF`, `DEM`), or the `--from` unit code (`GB`, `GBD`, `OZ`) because the amount is denominated in that unit. `--currency` applies to the whole file.
- `fx_rate` is fixed-point with 6 decimals and empty for USD rows; `fx_effective`, `fx_mode`, `fx_note` are text (`fx_note` may contain non-ASCII characters; output is UTF-8).
- Fixed-point formatting: `gold_usd_per_oz` 4 decimals, `troy_oz` 6, `GB` 3, `GBD` 4, `USD` 2. LF line endings. UTF-8 BOM and CRLF input accepted.
- Errors abort with the line number (unparsable date or amount, future date, missing columns). Rows without price data are skipped with a warning on stderr.

## Test hooks

`--vectors OUT.json --cases FILE` writes golden test vectors (spec 5.7) and `--dates-oracle OUT.json` writes the date accept/reject oracle, both offline against the cache directory (repository test tooling; see `test-vectors/regenerate.py`). `GOLDVALUE_TODAY=YYYY-MM-DD` overrides today. `GOLDVALUE_OFFLINE=1` or `--no-refresh` disables downloads and stale-refresh; a missing cache file is an error and `--refresh` is rejected. `GOLD_PRICE_CACHE_DIR` relocates the cache. FX vectors: `--vectors fx.json --cases fx-cases.json` (cases carry a `currency`; needs `fx_*.csv` in the cache directory, i.e. the synthetic snapshot); `test-vectors/regenerate.py` runs it and runs `batch-fx-<ccy>-in.csv` with `--currency <CCY>`.
