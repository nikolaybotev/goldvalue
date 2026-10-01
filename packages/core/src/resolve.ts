import { addDays, type CivilDate, formatIso, formatMonth, type Period, pad } from "./dates";
import { fmean } from "./fsum";
import { type GoldTable, LBMA_START, monthlySeriesSource, PriceNotFoundError } from "./table";

export const ROLLBACK_DAYS = 9;

export interface PriceInfo {
  price: number;
  granularity: "day" | "month" | "year";
  effective: string;
  points: number;
  source: string;
  note: string;
}

const NOT_LOADED = "daily LBMA prices not loaded";

/** Line-for-line port of `GoldTable.price_for_day`. */
export function priceForDay(table: GoldTable, day: CivilDate): PriceInfo {
  const dayIso = formatIso(day);
  if (dayIso >= LBMA_START) {
    for (let back = 0; back <= ROLLBACK_DAYS; back++) {
      const probe = formatIso(addDays(day, -back));
      const price = table.dailyValue(probe);
      if (price !== undefined) {
        const note =
          back === 0
            ? "LBMA fix on the requested date"
            : `no LBMA fix on ${dayIso} (non-trading day); used previous fix from ${probe}`;
        return { price, granularity: "day", effective: probe, points: 1, source: "LBMA", note };
      }
    }
    const last = table.lastDaily;
    if (last !== null && dayIso > last) {
      return {
        price: table.dailyValue(last) as number,
        granularity: "day",
        effective: last,
        points: 1,
        source: "LBMA",
        note: `requested date is after the latest available fix; used ${last}`,
      };
    }
  }
  const price = table.monthlyValue(day.year, day.month);
  if (price !== undefined) {
    let reason: string;
    if (dayIso < LBMA_START) reason = "no daily data before 1968";
    else if (!table.hasDaily) reason = NOT_LOADED;
    else reason = `no LBMA fix within ${ROLLBACK_DAYS} days before ${dayIso}`;
    return {
      price,
      granularity: "month",
      effective: formatMonth(day.year, day.month),
      points: 1,
      source: monthlySeriesSource(day.year),
      note: `${reason}; used the monthly price`,
    };
  }
  throw new PriceNotFoundError(`no gold price data for ${dayIso}`);
}

/** Port of `price_for_month`. `today` drives the "(month to date)" note. */
export function priceForMonth(
  table: GoldTable,
  year: number,
  month: number,
  today: CivilDate,
): PriceInfo {
  const effective = formatMonth(year, month);
  const fixes = table.dailyBetween(`${effective}-01`, `${effective}-31`);
  if (fixes.length > 0) {
    const partial = year === today.year && month === today.month ? " (month to date)" : "";
    return {
      price: fmean(fixes),
      granularity: "month",
      effective,
      points: fixes.length,
      source: "LBMA",
      note: `average of ${fixes.length} LBMA daily fixes${partial}`,
    };
  }
  const price = table.monthlyValue(year, month);
  if (price !== undefined) {
    const notLoaded = !table.hasDaily && `${effective}-01` >= LBMA_START;
    return {
      price,
      granularity: "month",
      effective,
      points: 1,
      source: monthlySeriesSource(year),
      note: notLoaded ? `monthly series value; ${NOT_LOADED}` : "monthly series value",
    };
  }
  throw new PriceNotFoundError(`no gold price data for ${effective}`);
}

/** Port of `price_for_year`. `today` drives the "(year to date)" note. */
export function priceForYear(table: GoldTable, year: number, today: CivilDate): PriceInfo {
  const fixes = table.dailyBetween(`${pad(year, 4)}-01-01`, `${pad(year, 4)}-12-31`);
  if (fixes.length > 0) {
    const partial = year === today.year ? " (year to date)" : "";
    return {
      price: fmean(fixes),
      granularity: "year",
      effective: pad(year, 4),
      points: fixes.length,
      source: "LBMA",
      note: `average of ${fixes.length} LBMA daily fixes${partial}`,
    };
  }
  const months = table.monthlyForYear(year);
  if (months.length > 0) {
    const notLoaded = !table.hasDaily && year >= 1968;
    const base = `average of ${months.length} monthly values`;
    return {
      price: fmean(months),
      granularity: "year",
      effective: pad(year, 4),
      points: months.length,
      source: monthlySeriesSource(year),
      note: notLoaded ? `${base}; ${NOT_LOADED}` : base,
    };
  }
  throw new PriceNotFoundError(`no gold price data for ${pad(year, 4)}`);
}

export function resolve(table: GoldTable, period: Period, today: CivilDate): PriceInfo {
  const { kind, anchor } = period;
  if (kind === "day") return priceForDay(table, anchor);
  if (kind === "month") return priceForMonth(table, anchor.year, anchor.month, today);
  return priceForYear(table, anchor.year, today);
}
