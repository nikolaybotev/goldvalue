import { DataCsvError, parseDataCsv } from "./csvdata";
import { formatIso, formatMonth, parseIso } from "./dates";
import { fmean } from "./fsum";

export class PriceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceNotFoundError";
  }
}

export const LBMA_START = "1968-01-02";

export type DailyEntry = readonly [date: string, usd: number];
export type MonthlyEntry = readonly [month: string, usd: number];

/** Full-month price and the source label that produced it. */
export interface MonthQuote {
  price: number;
  source: string;
}

/** Source label for a monthly-file value (LBMA daily means use "LBMA"). */
export function monthlySeriesSource(year: number): string {
  return year >= 1960
    ? "World Bank Pink Sheet (monthly)"
    : "Timothy Green / NMA table (annual average)";
}

function toNumber(text: string, what: string): number {
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) throw new DataCsvError(`invalid ${what}: ${text}`);
  return value;
}

/** Parse the CLI's `monthly.csv` (`month,usd`) into monthly entries. */
export function parseMonthlyCsv(monthlyCsv: string): MonthlyEntry[] {
  const monthly: MonthlyEntry[] = [];
  for (const [month, usd] of parseDataCsv(monthlyCsv, ["month", "usd"]) as [string, string][]) {
    const match = /^([0-9]+)-([0-9]+)$/.exec(month);
    if (!match) throw new DataCsvError(`invalid month: ${month}`);
    monthly.push([
      formatMonth(Number(match[1]), Number(match[2])),
      toNumber(usd, `price for ${month}`),
    ]);
  }
  return monthly;
}

/**
 * The two price tables the resolution rules read: one USD price per LBMA day (PM
 * fix, else AM) and the monthly series. Dates are ISO strings, which sort like dates.
 * The daily table may be empty (LBMA not loaded yet); resolution then falls back to
 * the monthly series and says so.
 */
export class GoldTable {
  readonly dailyDates: readonly string[];
  private readonly dailyValues: readonly number[];
  private readonly dailyIndex: ReadonlyMap<string, number>;
  private readonly monthlyByMonth: ReadonlyMap<string, number>;
  private readonly monthlyByYear: ReadonlyMap<number, number[]>;
  /** Full-month means. Never written back into `monthlyByMonth`. */
  private readonly monthQuotes: ReadonlyMap<string, MonthQuote>;
  /** Earliest month that has a full-month price, or null when the table is empty. */
  readonly seriesStart: string | null;

  constructor(daily: Iterable<DailyEntry>, monthly: Iterable<MonthlyEntry>) {
    const sorted = [...daily].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const index = new Map<string, number>();
    const dates: string[] = [];
    const values: number[] = [];
    for (const [date, usd] of sorted) {
      const existing = index.get(date);
      if (existing !== undefined) {
        values[existing] = usd;
        continue;
      }
      index.set(date, dates.length);
      dates.push(date);
      values.push(usd);
    }
    this.dailyDates = dates;
    this.dailyValues = values;
    this.dailyIndex = index;

    const byMonth = new Map<string, number>();
    const byYear = new Map<number, number[]>();
    for (const [month, usd] of monthly) {
      byMonth.set(month, usd);
    }
    for (const [month, usd] of byMonth) {
      const year = Number(month.slice(0, 4));
      const list = byYear.get(year);
      if (list) list.push(usd);
      else byYear.set(year, [usd]);
    }
    this.monthlyByMonth = byMonth;
    this.monthlyByYear = byYear;

    const quotes = new Map<string, MonthQuote>();
    let cursor = 0;
    while (cursor < dates.length) {
      const month = (dates[cursor] as string).slice(0, 7);
      const fixes: number[] = [];
      while (cursor < dates.length && (dates[cursor] as string).slice(0, 7) === month) {
        fixes.push(values[cursor] as number);
        cursor++;
      }
      quotes.set(month, { price: fmean(fixes), source: "LBMA" });
    }
    for (const [month, usd] of byMonth) {
      if (!quotes.has(month)) {
        quotes.set(month, {
          price: usd,
          source: monthlySeriesSource(Number(month.slice(0, 4))),
        });
      }
    }
    let seriesStart: string | null = null;
    for (const month of quotes.keys()) {
      if (seriesStart === null || month < seriesStart) seriesStart = month;
    }
    this.monthQuotes = quotes;
    this.seriesStart = seriesStart;
  }

  /** Build from the CLI cache CSVs. `lbmaCsv` may be null when daily data is unavailable. */
  static fromCsv(lbmaCsv: string | null, monthlyCsv: string): GoldTable {
    const daily: DailyEntry[] = [];
    if (lbmaCsv !== null) {
      for (const [date, am, pm] of parseDataCsv(lbmaCsv, ["date", "usd_am", "usd_pm"]) as [
        string,
        string,
        string,
      ][]) {
        const value = pm || am;
        if (!value) continue;
        daily.push([formatIso(parseIso(date)), toNumber(value, `price on ${date}`)]);
      }
    }
    return new GoldTable(daily, parseMonthlyCsv(monthlyCsv));
  }

  get hasDaily(): boolean {
    return this.dailyDates.length > 0;
  }

  get lastDaily(): string | null {
    return this.dailyDates.at(-1) ?? null;
  }

  dailyValue(date: string): number | undefined {
    const index = this.dailyIndex.get(date);
    return index === undefined ? undefined : this.dailyValues[index];
  }

  /** Daily values with `first <= date <= last` (ISO strings). */
  dailyBetween(first: string, last: string): number[] {
    let lo = 0;
    let hi = this.dailyDates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.dailyDates[mid] as string) < first) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let i = lo; i < this.dailyDates.length && (this.dailyDates[i] as string) <= last; i++) {
      out.push(this.dailyValues[i] as number);
    }
    return out;
  }

  monthlyValue(year: number, month: number): number | undefined {
    return this.monthlyByMonth.get(formatMonth(year, month));
  }

  /** Full-month mean. A clipped last month is computed per query, not stored here. */
  monthQuote(year: number, month: number): MonthQuote | undefined {
    return this.monthQuotes.get(formatMonth(year, month));
  }

  monthlyForYear(year: number): number[] {
    return this.monthlyByYear.get(year) ?? [];
  }
}
