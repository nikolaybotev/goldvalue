import { SYNTHETIC_DEM_NOTE, SYNTHETIC_EUR_NOTE } from "@goldvalue/core";
import { BIS_ATTRIBUTION, LBMA_ATTRIBUTION, LINKS, MONTHLY_ATTRIBUTION } from "../lib/attribution";

/** FR19: the methodology, always visible (AC6). */
export function Method() {
  return (
    <section class="method" id="method" aria-labelledby="method-heading">
      <h2 id="method-heading">Method</h2>
      <p class="method-lead">
        <strong>Values are gold-denominated, not CPI.</strong> Each dollar amount is converted at
        the gold price for its date, so a figure says how much gold the amount bought, not what a
        consumer price index would call the same purchasing power. Gold-based and CPI-based answers
        can differ substantially.
      </p>
      <p data-testid="smoothed-copy">
        {
          "Smoothed mode divides by a trailing average of monthly gold prices over the selected window. It is a store-of-value gauge for comparing snapshots across long horizons. It is not a consumer-price index and not a claim that gold tracks inflation."
        }
      </p>

      <h3>Units</h3>
      <ul>
        <li>
          <strong>GB</strong> (goldback): 1/1000 troy ounce of gold.{" "}
          <code>GB = USD / price x 1000</code>
        </li>
        <li>
          <strong>GBD</strong> (gold-backed dollar): 1/50 troy ounce, a unit defined by this
          project. <code>GBD = USD / price x 50</code>
        </li>
        <li>
          <strong>Troy oz</strong>: <code>oz = USD / price</code>
        </li>
      </ul>
      <p>
        The price is the USD spot benchmark per troy ounce, not a dealer quote with premium. The
        sheet currency is US dollars unless another is selected; other currencies become dollars
        first.
      </p>

      <h3>Sources</h3>
      <ul>
        <li>
          <strong>Daily, 1968 onward:</strong> the LBMA Gold Price in USD (PM fix, AM fix where
          there is no PM), downloaded by your browser from prices.lbma.org.uk and kept in your
          browser.
        </li>
        <li>
          <strong>Monthly, 1833 to 1967 and as a fallback:</strong> the{" "}
          <a href={LINKS.monthlySeries}>datasets/gold-prices</a> series (World Bank Pink Sheet from
          1960, Timothy Green / NMA annual averages before that).
        </li>
      </ul>

      <h3>How a date becomes a price</h3>
      <table class="method-table">
        <caption class="sr-only">Price resolution rules</caption>
        <thead>
          <tr>
            <th scope="col">You enter</th>
            <th scope="col">1968-01-02 onward</th>
            <th scope="col">Before 1968</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">A day</th>
            <td>
              The LBMA fix that day; if there is none, the latest earlier fix within 9 days. A day
              after the latest fix uses the latest fix and says so.
            </td>
            <td>The monthly value for that month.</td>
          </tr>
          <tr>
            <th scope="row">A month</th>
            <td>The mean of that month's daily fixes (month to date for the current month).</td>
            <td>The monthly value.</td>
          </tr>
          <tr>
            <th scope="row">A year</th>
            <td>The mean of that year's daily fixes (year to date for the current year).</td>
            <td>The mean of the 12 monthly values.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Until the daily LBMA table has been downloaded (or if it cannot be), rows use the monthly
        series and say "daily LBMA prices not loaded". Pre-1960 monthly values are annual averages
        repeated for each month. Before 1971 the dollar was pegged near $35 per ounce, so early
        conversions are close to fixed ratios; see the{" "}
        <a href={LINKS.historicalNotes}>historical notes</a> and the{" "}
        <a href={LINKS.reference}>source and method reference</a>.
      </p>
      <p>
        The chart places a row at the middle of the period you entered (the day itself, the 16th of
        a month, 2 July of a year), whichever fix was used.
      </p>

      <h3>Other currencies</h3>
      <p>
        EUR, GBP, CHF, and DEM follow the USD-routing tenet: the amount becomes US dollars at the
        historical exchange rate for the same day, month, or year, and that dollar amount becomes
        gold at the USD benchmark. Gold prices quoted in other currencies are never used. A month or
        a year is a ratio of means: the mean exchange rate over the period and the mean gold price
        over the period, each over its own observations. One currency applies to every row.
      </p>
      <p>
        Rates are the BIS daily series, published from 1953 and about a week behind today. The euro
        and the Deutsche Mark share one series (there is no separate mark file): the mark is the
        euro divided by 1.95583, and choosing either currency loads that series.
      </p>
      <p>
        Before a currency's first BIS observation (GBP 1953-08-10; CHF, EUR, and DEM 1953-09-01) the
        rate is the Bretton Woods par value in force on that date, a fixed stepwise approximation.
        Those rows and chart points are amber. A date before the parity table starts (GBP 1940, CHF
        1949, DEM and EUR 1948) uses the earliest table entry and is marked more strongly, because
        the rate is only indicative. Sterling was about $4.87 on the gold standard before 1931 and
        floated in the 1930s.
      </p>
      <p>{SYNTHETIC_EUR_NOTE}</p>
      <p>{SYNTHETIC_DEM_NOTE}</p>
      <p>Caveats for early rates are in the historical notes linked above.</p>

      <h3>Data terms</h3>
      <p>{LBMA_ATTRIBUTION}</p>
      <p>{MONTHLY_ATTRIBUTION}</p>
      <p>{BIS_ATTRIBUTION}</p>
      <p class="muted">
        Your rows stay in this browser. There is no account, analytics, or tracking.
      </p>
    </section>
  );
}
