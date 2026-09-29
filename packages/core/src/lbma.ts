import { parseIso } from "./dates";

export const LBMA_PM_URL = "https://prices.lbma.org.uk/json/gold_pm.json";
export const LBMA_AM_URL = "https://prices.lbma.org.uk/json/gold_am.json";

/** One London business day; a fix is null when that session has no USD price. */
export interface LbmaRow {
  date: string;
  am: number | null;
  pm: number | null;
}

/** The subset of `fetch` the loader needs, so core has no DOM dependency. */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class LbmaFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LbmaFormatError";
  }
}

/**
 * Parse one LBMA JSON file (`[{"d": "YYYY-MM-DD", "v": [usd, gbp, eur]}, ...]`) into
 * USD price by date. Extra keys (the feed adds `is_cms_locked`) and null entries
 * (EUR before 1999, sessions without a price) are tolerated; only USD is kept.
 */
export function parseLbmaJson(payload: unknown): Map<string, number> {
  if (!Array.isArray(payload)) throw new LbmaFormatError("LBMA payload is not an array");
  const out = new Map<string, number>();
  for (const row of payload as unknown[]) {
    if (typeof row !== "object" || row === null)
      throw new LbmaFormatError("LBMA row is not an object");
    const { d, v } = row as { d?: unknown; v?: unknown };
    if (typeof d !== "string" || !Array.isArray(v)) {
      throw new LbmaFormatError("LBMA row needs a string 'd' and an array 'v'");
    }
    parseIso(d);
    const usd: unknown = v[0];
    if (usd === null || usd === undefined) continue;
    if (typeof usd !== "number" || !Number.isFinite(usd)) {
      throw new LbmaFormatError(`LBMA USD price on ${d} is not a number`);
    }
    out.set(d, usd);
  }
  return out;
}

/** Merge AM and PM maps into rows sorted by date (port of the merge in `fetch_lbma`). */
export function mergeLbma(
  pm: ReadonlyMap<string, number>,
  am: ReadonlyMap<string, number>,
): LbmaRow[] {
  const dates = [...new Set([...pm.keys(), ...am.keys()])].sort();
  return dates.map((date) => ({ date, am: am.get(date) ?? null, pm: pm.get(date) ?? null }));
}

async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) throw new LbmaFormatError(`${url} returned HTTP ${response.status}`);
  return response.json();
}

/**
 * Download the AM and PM histories and return the merged rows dated `since` or later
 * (all rows when `since` is null). LBMA serves the full history in one file, so
 * `since` only trims what the caller has to merge into its stored table.
 */
export async function fetchLbmaSince(
  fetchFn: FetchLike,
  since: string | null = null,
): Promise<LbmaRow[]> {
  const [pmJson, amJson] = await Promise.all([
    fetchJson(fetchFn, LBMA_PM_URL),
    fetchJson(fetchFn, LBMA_AM_URL),
  ]);
  const rows = mergeLbma(parseLbmaJson(pmJson), parseLbmaJson(amJson));
  return since === null ? rows : rows.filter((row) => row.date >= since);
}

/** Convert merged rows to the `[date, usd]` entries `GoldTable` reads (PM, else AM). */
export function lbmaToDaily(rows: readonly LbmaRow[]): [string, number][] {
  const out: [string, number][] = [];
  for (const row of rows) {
    const usd = row.pm ?? row.am;
    if (usd !== null) out.push([row.date, usd]);
  }
  return out;
}
