import { Freshness } from "./Freshness";
import { Workspace } from "./layout/Workspace";
import { Footer } from "./method/Footer";
import { Method } from "./method/Method";

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
        <Freshness />
        <Workspace />
        <Method />
      </main>
      <Footer />
    </div>
  );
}
