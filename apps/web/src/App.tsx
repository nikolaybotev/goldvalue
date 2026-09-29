import { Sheet } from "./sheet/Sheet";
import { dailyStatus, monthlyStatus, refreshDaily } from "./store/data";

function DataStatus() {
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
  let text: string;
  if (monthly.state === "loading") text = "Loading price data";
  else if (daily.phase === "loading" && daily.lastFix === null) {
    text = "Downloading daily LBMA prices; showing monthly values until they arrive";
  } else if (daily.lastFix === null) {
    text =
      daily.phase === "failed"
        ? "Daily LBMA prices not loaded; showing monthly values"
        : "Daily LBMA prices not loaded";
  } else text = `Daily LBMA prices loaded through ${daily.lastFix}`;
  return (
    <p class="data-status" role="status" data-testid="data-status">
      {text}
      {daily.phase === "failed" && (
        <>
          {" "}
          <button
            type="button"
            class="link-btn"
            onClick={() => void refreshDaily({ ignoreRateLimit: daily.lastFix === null })}
          >
            Retry
          </button>
        </>
      )}
    </p>
  );
}

export function App() {
  return (
    <div class="page">
      <header class="masthead">
        <h1>GoldValue</h1>
        <p class="tagline">
          Dated dollar amounts in gold: goldbacks (GB), gold-backed dollars (GBD), and troy ounces.
        </p>
      </header>
      <main>
        <DataStatus />
        <Sheet />
      </main>
    </div>
  );
}
