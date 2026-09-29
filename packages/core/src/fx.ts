import { parseDataCsv } from "./csvdata";
import {
  addDays,
  type CivilDate,
  daysInMonth,
  formatIso,
  formatMonth,
  type Period,
  pad,
  parseIso,
  toDayNumber,
} from "./dates";
import { fmean } from "./fsum";
import {
  BIS_LAG_NOTE,
  DEM_LAST_DAY,
  DEM_PER_EUR,
  EURO_START,
  parityRate,
  SYNTHETIC_DEM_NOTE,
  SYNTHETIC_EUR_NOTE,
} from "./parity";
import { ROLLBACK_DAYS } from "./resolve";
import { PriceNotFoundError } from "./table";

export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "DEM"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Non-USD currencies, the ones with an FX rate. */
export type ForeignCurrency = Exclude<Currency, "USD">;
/** The cached BIS files: DEM has none of its own (it is derived from EUR). */
export type FxSource = "EUR" | "GBP" | "CHF";

/** `fx_mode` values in precedence order: the highest applicable one is reported. */
export const FX_MODES = ["daily", "synthetic", "parity", "extrapolated"] as const;
export type FxMode = (typeof FX_MODES)[number];

/** A rate older than this many days after the last observation gets the BIS lag note. */
export const FX_STALE_DAYS = 3;

export class CurrencyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyParseError";
  }
}

export function parseCurrency(text: string): Currency {
  const key = text.trim().toUpperCase();
  const currency = (CURRENCIES as readonly string[]).includes(key) ? (key as Currency) : undefined;
  if (!currency) {
    throw new CurrencyParseError(
      `unknown currency ${JSON.stringify(text)}; use ${CURRENCIES.join(", ")}`,
    );
  }
  return currency;
}

/** The BIS file that supplies a currency's rate (`null` for USD). */
export function fxSourceOf(currency: Currency): FxSource | null {
  if (currency === "USD") return null;
  return currency === "DEM" ? "EUR" : currency;
}

/** File name of a source's published/cached CSV. */
export const fxFileName = (source: FxSource): string => `fx_${source.toLowerCase()}.csv`;

/** Daily USD-per-unit observations from one `fx_*.csv` (`date,usd_per_unit`). */
export class FxTable {
  readonly dates: readonly string[];
  private readonly values: readonly number[];
  private readonly index: ReadonlyMap<string, number>;

  constructor(entries: Iterable<readonly [date: string, usdPerUnit: number]>) {
    const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dates: string[] = [];
    const values: number[] = [];
    const index = new Map<string, number>();
    for (const [date, value] of sorted) {
      const existing = index.get(date);
      if (existing !== undefined) {
        values[existing] = value;
        continue;
      }
      index.set(date, dates.length);
      dates.push(date);
      values.push(value);
    }
    if (dates.length === 0) throw new PriceNotFoundError("FX table has no observations");
    this.dates = dates;
    this.values = values;
    this.index = index;
  }

  static fromCsv(text: string): FxTable {
    const rows = parseDataCsv(text, ["date", "usd_per_unit"]) as [string, string][];
    return new FxTable(rows.map(([date, value]) => [date, Number(value)] as const));
  }

  get first(): string {
    return this.dates[0] as string;
  }

  get last(): string {
    return this.dates.at(-1) as string;
  }

  value(date: string): number | undefined {
    const at = this.index.get(date);
    return at === undefined ? undefined : this.values[at];
  }

  /** Observations with `first <= date <= last`. */
  between(first: string, last: string): { dates: string[]; values: number[] } {
    const lo = this.lowerBound(first);
    const dates: string[] = [];
    const values: number[] = [];
    for (let i = lo; i < this.dates.length && (this.dates[i] as string) <= last; i++) {
      dates.push(this.dates[i] as string);
      values.push(this.values[i] as number);
    }
    return { dates, values };
  }

  /** The latest observation date strictly before `date`. */
  before(date: string): string {
    const at = this.lowerBound(date) - 1;
    return this.dates[at < 0 ? this.dates.length - 1 : at] as string;
  }

  private lowerBound(date: string): number {
    let lo = 0;
    let hi = this.dates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.dates[mid] as string) < date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** The FX tables a computation needs, keyed by BIS source. */
export class FxRates {
  private readonly tables: ReadonlyMap<FxSource, FxTable>;

  constructor(tables: Iterable<readonly [FxSource, FxTable]>) {
    this.tables = new Map(tables);
  }

  static fromCsv(files: Partial<Record<FxSource, string>>): FxRates {
    const parsed: [FxSource, FxTable][] = [];
    for (const source of ["EUR", "GBP", "CHF"] as const) {
      const text = files[source];
      if (text !== undefined) parsed.push([source, FxTable.fromCsv(text)]);
    }
    return new FxRates(parsed);
  }

  has(currency: Currency): boolean {
    const source = fxSourceOf(currency);
    return source !== null && this.tables.has(source);
  }

  tableFor(currency: ForeignCurrency): FxTable {
    const table = this.tables.get(fxSourceOf(currency) as FxSource);
    if (!table) throw new PriceNotFoundError(`no FX data loaded for ${currency}`);
    return table;
  }
}

export interface FxResolution {
  rate: number;
  effective: string;
  mode: FxMode;
  note: string;
}

interface Bounds {
  start: string;
  end: string;
}

function periodBounds({ kind, anchor }: Period): Bounds {
  if (kind === "day") {
    const iso = formatIso(anchor);
    return { start: iso, end: iso };
  }
  if (kind === "month") {
    const start = formatIso({ year: anchor.year, month: anchor.month, day: 1 });
    const end = formatIso({
      year: anchor.year,
      month: anchor.month,
      day: daysInMonth(anchor.year, anchor.month),
    });
    return { start, end };
  }
  return {
    start: formatIso({ year: anchor.year, month: 1, day: 1 }),
    end: formatIso({ year: anchor.year, month: 12, day: 31 }),
  };
}

/** The point the chart uses (spec FR12): the day, the 16th, or 2 July. */
function periodMidpoint({ kind, anchor }: Period): string {
  if (kind === "day") return formatIso(anchor);
  if (kind === "month") return formatIso({ year: anchor.year, month: anchor.month, day: 16 });
  return formatIso({ year: anchor.year, month: 7, day: 2 });
}

function isSynthetic(currency: ForeignCurrency, usedFirst: string, usedLast: string): boolean {
  if (currency === "EUR") return usedFirst < EURO_START;
  if (currency === "DEM") return usedLast > DEM_LAST_DAY;
  return false;
}

const daysBetween = (later: string, earlier: string): number =>
  toDayNumber(parseIso(later)) - toDayNumber(parseIso(earlier));

const minIso = (a: string, b: string): string => (a < b ? a : b);

/**
 * Port of `resolve_fx` (spec 6.2b, D10): USD per unit for a query. Daily observations
 * win; before the first observation the parity table applies (`parity`, or
 * `extrapolated` before the table starts); `synthetic` marks EUR before 1999-01-04 and
 * DEM after 1998-12-31 by the observation dates actually used. The mode is the highest
 * of daily < synthetic < parity < extrapolated and the note lists every explanation.
 */
export function resolveFx(
  rates: FxRates,
  currency: ForeignCurrency,
  period: Period,
  today: CivilDate,
): FxResolution {
  const table = rates.tableFor(currency);
  const scale = currency === "DEM" ? (v: number) => v / DEM_PER_EUR : (v: number) => v;
  const { start, end } = periodBounds(period);
  const { kind, anchor } = period;
  const midpoint = periodMidpoint(period);
  const notes: string[] = [];
  let parity: ReturnType<typeof parityRate> | null = null;
  let rate = 0;
  let effective = "";
  let used: [string, string] = [midpoint, midpoint];

  if (kind === "day") {
    const day = formatIso(anchor);
    let found: { probe: string; value: number; back: number } | null = null;
    for (let back = 0; back <= ROLLBACK_DAYS; back++) {
      const probe = formatIso(addDays(anchor, -back));
      const value = table.value(probe);
      if (value !== undefined) {
        found = { probe, value, back };
        break;
      }
    }
    let probe = "";
    let value = 0;
    if (found) {
      ({ probe, value } = found);
      if (found.back > 0) {
        let text = `no FX rate on ${day}`;
        if (day <= table.last && found.back <= FX_STALE_DAYS) text += " (non-trading day)";
        text += `; used previous rate from ${probe}`;
        if (day > table.last && found.back > FX_STALE_DAYS) text += ` (${BIS_LAG_NOTE})`;
        notes.push(text);
      }
    } else if (day > table.last) {
      probe = table.last;
      value = table.value(table.last) as number;
      notes.push(
        `requested date is after the latest available FX rate; used ${probe} (${BIS_LAG_NOTE})`,
      );
    } else if (day < table.first) {
      parity = parityRate(currency, day, table.first);
    } else {
      probe = table.before(day);
      value = table.value(probe) as number;
      notes.push(
        `no FX rate within ${ROLLBACK_DAYS} days before ${day}; used previous rate from ${probe}`,
      );
    }
    if (parity === null) {
      rate = scale(value);
      effective = probe;
      used = [probe, probe];
    }
  } else {
    const label = kind === "month" ? formatMonth(anchor.year, anchor.month) : pad(anchor.year, 4);
    const { dates, values } = table.between(start, end);
    if (dates.length > 0) {
      rate = fmean(values.map(scale));
      effective = label;
      used = [dates[0] as string, dates.at(-1) as string];
      if (start < table.first) {
        notes.push(
          `period starts before the first BIS observation (${table.first}); ` +
            "average of the observations from that date",
        );
      }
      if (
        end > table.last &&
        daysBetween(minIso(end, formatIso(today)), table.last) > FX_STALE_DAYS
      ) {
        notes.push(
          `period extends past the latest BIS observation (${table.last}); ` +
            `average of the ${dates.length} available daily rates (${BIS_LAG_NOTE})`,
        );
      }
    } else if (end < table.first) {
      parity = parityRate(currency, midpoint, table.first);
    } else if (start > table.last) {
      const probe = table.last;
      rate = scale(table.value(probe) as number);
      effective = probe;
      used = [probe, probe];
      notes.push(
        `requested period is after the latest available FX rate; used ${probe} (${BIS_LAG_NOTE})`,
      );
    } else {
      const probe = table.before(start);
      rate = scale(table.value(probe) as number);
      effective = probe;
      used = [probe, probe];
      notes.push(`no FX rate in the period; used previous rate from ${probe}`);
    }
  }

  const modes: FxMode[] = ["daily"];
  const lead: string[] = [];
  if (parity !== null) {
    rate = parity.rate;
    effective = parity.effective;
    used = [midpoint, midpoint];
    modes.push(parity.kind);
    lead.push(parity.note);
  }
  if (isSynthetic(currency, used[0], used[1])) {
    modes.push("synthetic");
    lead.push(currency === "EUR" ? SYNTHETIC_EUR_NOTE : SYNTHETIC_DEM_NOTE);
  }
  const mode = modes.reduce((best, m) => (FX_MODES.indexOf(m) > FX_MODES.indexOf(best) ? m : best));
  return { rate, effective, mode, note: [...lead, ...notes].join(" ") };
}
