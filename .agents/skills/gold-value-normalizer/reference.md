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

### Sources evaluated and not used

- FRED `GOLDAMGBD228NLBM` / `GOLDPMGBD228NLBM`: removed from FRED; returns 404.
- Bundesbank gold series: 1968+ only, no advantage over LBMA.
- Kitco / goldprice.org historical tables: HTML scraping, no stable CSV endpoint.

## Resolution methodology

| Query | 1968-01-02 onward | Before 1968 |
|-------|-------------------|-------------|
| Exact day | LBMA fix that day; if none (weekend/holiday), most recent prior fix within 10 days | Monthly value for that month |
| Month | Arithmetic mean of LBMA daily fixes in the month | Monthly series value |
| Year | Arithmetic mean of LBMA daily fixes in the year (year-to-date for current year) | Mean of the 12 monthly values |

Averages are simple (unweighted) means of trading-day fixes, which matches how LBMA and the World Bank publish their own monthly averages.

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

Delete the directory or run with `--refresh` to rebuild.
