import { render } from "preact";
import { App } from "./App";
import { boot } from "./store/data";
import { ensureFx } from "./store/fx";
import { refreshToday } from "./store/sheet-store";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<App />, root);

/** Start the data requests after the first paint so they never compete with it (NFR1). */
function afterFirstPaint(task: () => void): void {
  let started = false;
  const run = () => {
    if (started) return;
    started = true;
    task();
  };
  requestAnimationFrame(() => setTimeout(run, 0));
  setTimeout(run, 400);
}

afterFirstPaint(() => {
  void boot();
  void ensureFx();
});
setInterval(refreshToday, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshToday();
});
