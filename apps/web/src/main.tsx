import { render } from "preact";
import { App } from "./App";
import { boot } from "./store/data";
import { refreshToday } from "./store/sheet-store";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<App />, root);

void boot();
setInterval(refreshToday, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshToday();
});
