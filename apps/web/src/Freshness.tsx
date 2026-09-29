import {
  dailyStatus,
  lastAttemptFailed,
  manualRefreshAllowed,
  monthlyStatus,
  nextRefreshAt,
  refreshDaily,
} from "./store/data";
import { currency, fxStatus } from "./store/fx";

const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** FR20: what data is loaded, how fresh it is, and a rate-limited Refresh. */
export function Freshness() {
  const monthly = monthlyStatus.value;
  const daily = dailyStatus.value;

  if (monthly.state === "unavailable") {
    return (
      <div class="banner banner-error" role="alert">
        <p>
          <strong>Price data not available offline.</strong> The monthly gold series could not be
          loaded, so nothing can be computed yet. Reconnect and reload.
        </p>
        <button type="button" class="btn" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  const loading = daily.phase === "loading";
  const allowed = manualRefreshAllowed(Date.now());
  const next = nextRefreshAt();
  const ccy = currency.value;
  const fx = fxStatus.value;

  let status: string;
  if (monthly.state === "loading") status = "Loading price data";
  else if (daily.lastFix !== null) status = `Daily LBMA prices loaded through ${daily.lastFix}`;
  else if (loading) {
    status = "Downloading daily LBMA prices; showing monthly values until they arrive";
  } else status = "Daily LBMA prices not loaded; showing monthly values";

  const details: string[] = [];
  if (daily.fetchedAt !== null) details.push(`downloaded ${when.format(daily.fetchedAt)}`);
  if (monthly.state === "ready" && monthly.lastMonth) {
    details.push(`monthly series through ${monthly.lastMonth}`);
  }
  if (ccy !== "USD") {
    if (fx.phase === "ready" && fx.lastDate) details.push(`FX (${ccy}) through ${fx.lastDate}`);
    else if (fx.phase === "loading") details.push(`loading ${ccy} exchange rates`);
  }

  return (
    <section class="freshness" aria-label="Data freshness">
      <p class="data-status" role="status" data-testid="data-status">
        {status}
        {details.length > 0 && <span class="muted">{` (${details.join("; ")})`}</span>}
        {ccy !== "USD" && fx.phase === "failed" && (
          <span class="error">{` ${ccy} exchange rates could not be loaded${
            fx.error ? `: ${fx.error}` : ""
          }.`}</span>
        )}
      </p>
      <button
        type="button"
        class="btn"
        disabled={loading || !allowed}
        aria-describedby="refresh-hint"
        onClick={() => void refreshDaily({ manual: true })}
      >
        {loading ? "Refreshing" : "Refresh"}
      </button>
      {monthly.state === "ready" && daily.lastFix === null && !loading && (
        <p class="degraded-note" role="note" data-testid="degraded-note">
          <strong>Degraded precision:</strong> daily LBMA prices are not loaded, so every value uses
          the monthly gold series. Daily prices cannot be downloaded while offline; reconnect and
          press Refresh.
        </p>
      )}
      <p id="refresh-hint" class="freshness-hint muted" data-testid="refresh-hint">
        {daily.phase === "failed" && (
          <span class="error" data-testid="refresh-error">
            {`Could not download LBMA prices${daily.error ? `: ${daily.error}` : ""}. `}
          </span>
        )}
        {allowed
          ? lastAttemptFailed.value
            ? "You can try again now."
            : "LBMA prices are downloaded again at most once every 12 hours."
          : next !== null
            ? `Refresh is limited to once every 12 hours; available after ${when.format(next)}.`
            : ""}
      </p>
    </section>
  );
}
