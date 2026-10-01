import { type CivilDate, compareDates, formatIso, formatMonth, type Period } from "./dates";
import { fmean } from "./fsum";
import { type GoldTable, PriceNotFoundError } from "./table";

/** Trailing window offered by `--smooth`. */
export type SmoothYears = 5 | 10 | 20;

export type GoldMode = "spot" | "smoothed" | "partial";

export interface SmoothQuote {
  price: number;
  source: string;
  note: string;
  gold_mode: "smoothed" | "partial";
  ma_years: SmoothYears;
  ma_months: number;
}

const NOT_LOADED = "daily LBMA prices not loaded";

function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta;
  let shiftedYear = Math.floor(index / 12);
  let shiftedMonth = index % 12;
  if (shiftedMonth < 0) {
    shiftedMonth += 12;
    shiftedYear -= 1;
  }
  return [shiftedYear, shiftedMonth + 1];
}

/**
 * Month that closes the trailing window (D17). A day uses that day's month. A month
 * uses that month. A completed year uses December. A year still in progress uses
 * the current month.
 */
export function windowEndMonth(period: Period, today: CivilDate): [number, number] {
  const { kind, anchor } = period;
  if (kind === "year") {
    if (anchor.year === today.year) return [today.year, today.month];
    return [anchor.year, 12];
  }
  return [anchor.year, anchor.month];
}

function minDate(a: CivilDate, b: CivilDate): CivilDate {
  return compareDates(a, b) <= 0 ? a : b;
}

/**
 * Price for one window month. `cutoffIso` is set only for the last month, and only
 * when the snapshot day falls in that month. The clipped mean is not stored.
 */
function monthForWindow(
  table: GoldTable,
  year: number,
  month: number,
  cutoffIso: string | null,
): { price: number; source: string; clipped: boolean } | null {
  const label = formatMonth(year, month);
  if (cutoffIso !== null) {
    const all = table.dailyBetween(`${label}-01`, `${label}-31`);
    const used = table.dailyBetween(`${label}-01`, cutoffIso);
    if (used.length > 0) {
      return { price: fmean(used), source: "LBMA", clipped: used.length < all.length };
    }
    if (all.length > 0) return null;
  }
  const quote = table.monthQuote(year, month);
  if (!quote) return null;
  return { price: quote.price, source: quote.source, clipped: false };
}

/**
 * Equal-month trailing mean of N×12 months ending at the snapshot's month.
 *
 * Missing months are skipped. Zero priced months throws PriceNotFoundError.
 * When the daily table is empty and the window includes a month on or after
 * 1968-01, the note gains `daily LBMA prices not loaded` once. Python does not
 * emit that phrase. Does not mutate the monthly map or the full-month cache.
 */
export function trailingAverage(
  table: GoldTable,
  period: Period,
  today: CivilDate,
  years: SmoothYears,
): SmoothQuote {
  const [endYear, endMonth] = windowEndMonth(period, today);
  const count = years * 12;
  const [startYear, startMonth] = shiftMonth(endYear, endMonth, -(count - 1));
  const startLabel = formatMonth(startYear, startMonth);
  const snapshot = period.kind === "day" ? period.anchor : null;
  const clip = snapshot !== null && snapshot.year === endYear && snapshot.month === endMonth;
  const cutoffIso = clip && snapshot !== null ? formatIso(minDate(snapshot, today)) : null;

  const used: { label: string; price: number; source: string }[] = [];
  const missing: string[] = [];
  let clipped = false;
  let year = startYear;
  let month = startMonth;
  for (let i = 0; i < count; i++) {
    const key = formatMonth(year, month);
    const isLast = year === endYear && month === endMonth;
    const got = monthForWindow(table, year, month, isLast ? cutoffIso : null);
    if (!got) {
      if (table.seriesStart !== null && key >= table.seriesStart) missing.push(key);
    } else {
      used.push({ label: key, price: got.price, source: got.source });
      clipped = clipped || got.clipped;
    }
    [year, month] = shiftMonth(year, month, 1);
  }

  const endLabel = formatMonth(endYear, endMonth);
  if (used.length === 0) {
    throw new PriceNotFoundError(
      `no gold price data for the ${years}-year span ending ${endLabel}`,
    );
  }

  const sources = new Set(used.map((month) => month.source));
  const source = sources.size === 1 ? (used[0] as (typeof used)[number]).source : "mixed";
  const unit = used.length === 1 ? "month" : "months";
  const first = (used[0] as (typeof used)[number]).label;
  const last = (used[used.length - 1] as (typeof used)[number]).label;
  let note = `${years}-year average; ${used.length} ${unit}, ${first} to ${last}`;
  if (clipped) note += " (month to date)";
  if (table.seriesStart !== null && startLabel < table.seriesStart) {
    note += `; series starts ${table.seriesStart}`;
  }
  if (missing.length > 0) note += `; missing ${missing.join(", ")}`;
  // TypeScript only. Python always has lbma_daily.csv or it errors.
  if (!table.hasDaily && endLabel >= "1968-01") note += `; ${NOT_LOADED}`;

  return {
    price: fmean(used.map((month) => month.price)),
    source,
    note,
    gold_mode: used.length === count ? "smoothed" : "partial",
    ma_years: years,
    ma_months: used.length,
  };
}
