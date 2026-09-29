import {
  type Currency,
  FxRates,
  type FxSource,
  FxTable,
  fxFileName,
  fxSourceOf,
  parseCurrency,
} from "@goldvalue/core";
import { signal } from "@preact/signals";

const CURRENCY_KEY = "goldvalue:v1:currency";

function loadCurrency(): Currency {
  try {
    if (typeof localStorage === "undefined") return "USD";
    const text = localStorage.getItem(CURRENCY_KEY);
    return text ? parseCurrency(text) : "USD";
  } catch {
    return "USD";
  }
}

/** Sheet-wide currency (D9). Remembered in this browser; default USD. */
export const currency = signal<Currency>(loadCurrency());

export interface FxStatus {
  phase: "loading" | "ready" | "failed";
  /** Latest observation of the selected currency's series, or null for USD and while loading. */
  lastDate: string | null;
  error: string | null;
}

const initial = currency.peek();
export const fxStatus = signal<FxStatus>(
  initial === "USD"
    ? { phase: "ready", lastDate: null, error: null }
    : { phase: "loading", lastDate: null, error: null },
);

/** Tables fetched so far. DEM is derived from the EUR table (there is no fx_dem.csv). */
const tables = new Map<FxSource, FxTable>();
export const fxRates = signal<FxRates>(new FxRates([]));

let generation = 0;

function remember(next: Currency): void {
  try {
    localStorage.setItem(CURRENCY_KEY, next);
  } catch {
    // The choice still applies for this visit.
  }
}

/**
 * Download the one BIS file a currency needs (spec 6.3). EUR and DEM share `fx_eur.csv`;
 * a file already in memory is not requested again. FX has no runtime top-up.
 */
export async function ensureFx(next: Currency = currency.peek()): Promise<void> {
  const id = ++generation;
  const source = fxSourceOf(next);
  if (source === null) {
    fxStatus.value = { phase: "ready", lastDate: null, error: null };
    return;
  }
  const cached = tables.get(source);
  if (cached) {
    if (id !== generation) return;
    if (!fxRates.peek().has(next)) fxRates.value = new FxRates(tables);
    fxStatus.value = { phase: "ready", lastDate: cached.last, error: null };
    return;
  }
  fxStatus.value = { phase: "loading", lastDate: null, error: null };
  try {
    const url = `${import.meta.env.BASE_URL}data/${fxFileName(source)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${fxFileName(source)} returned HTTP ${response.status}`);
    const parsed = FxTable.fromCsv(await response.text());
    tables.set(source, parsed);
    if (id !== generation) return;
    fxRates.value = new FxRates(tables);
    fxStatus.value = { phase: "ready", lastDate: parsed.last, error: null };
  } catch (error) {
    if (id !== generation) return;
    fxStatus.value = {
      phase: "failed",
      lastDate: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Apply a sheet currency. Unknown text is ignored. Recomputes once the rate file is in memory. */
export function setCurrency(value: string): void {
  let next: Currency;
  try {
    next = parseCurrency(value);
  } catch {
    return;
  }
  if (next === currency.peek()) return;
  currency.value = next;
  remember(next);
  void ensureFx(next);
}
