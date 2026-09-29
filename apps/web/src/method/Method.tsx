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
        The price is the USD spot benchmark per troy ounce, not a dealer quote with premium. Amounts
        are US dollars.
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
