import { parseAmount } from "./amounts";
import { type CivilDate, checkNotFuture, type Period, type PeriodKind, parseDate } from "./dates";
import { type Currency, type FxMode, type FxRates, parseCurrency, resolveFx } from "./fx";
import { resolve } from "./resolve";
import { type GoldMode, type SmoothYears, trailingAverage } from "./smooth";
import { type GoldTable, PriceNotFoundError } from "./table";
import { fromOz, parseUnit, toOz, type Unit } from "./units";

export class CurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyError";
  }
}

/** Result of one conversion; the keys and meanings are the CLI's `--json` output. */
export interface ConversionResult {
  input: {
    amount: number;
    unit: Unit;
    currency: Currency;
    period: string;
    granularity: PeriodKind;
  };
  effective: string;
  granularity: PeriodKind;
  points: number;
  gold_usd_per_oz: number;
  price_source: string;
  note: string;
  troy_oz: number;
  GB: number;
  GBD: number;
  USD: number;
  /** USD per one unit of the currency; null for USD amounts (all four fx_* fields). */
  fx_rate: number | null;
  fx_effective: string | null;
  fx_mode: FxMode | null;
  fx_note: string | null;
  /** `spot`, `smoothed`, or `partial`. */
  gold_mode: GoldMode;
  /** 5, 10, or 20 when smoothing; null in spot mode. */
  ma_years: SmoothYears | null;
  /** Months that entered the mean; null in spot mode. */
  ma_months: number | null;
  /** v1 spot price. Equals `gold_usd_per_oz` in spot mode. */
  spot_usd_per_oz: number;
  price_note: string;
  price_points: number;
}

/**
 * Port of `convert`: resolve the price (and FX) for `period` and convert `amount`. A
 * non-USD `currency` (only with unit USD) becomes USD at the FX rate for the same period
 * first (USD-routing tenet), then gold. Month and year queries are a ratio of means.
 * `smooth` divides by the trailing monthly mean; FX stays the spot rate. Negative
 * amounts keep their sign. `effective`, `granularity`, and `points` stay the spot
 * resolution.
 */
export function convert(
  table: GoldTable,
  amount: number,
  unit: Unit,
  period: Period,
  today: CivilDate,
  currency: Currency = "USD",
  fx?: FxRates,
  smooth?: SmoothYears,
): ConversionResult {
  if (smooth !== undefined && unit !== "USD") {
    throw new CurrencyError("--smooth is only valid with --from USD");
  }
  const gauge = smooth === undefined ? null : trailingAverage(table, period, today, smooth);
  const info = resolve(table, period, today);
  const price = gauge ? gauge.price : info.price;
  const note = gauge ? gauge.note : info.note;
  const source = gauge ? gauge.source : info.source;
  let usdAmount = amount;
  let fxOut: Pick<ConversionResult, "fx_rate" | "fx_effective" | "fx_mode" | "fx_note"> = {
    fx_rate: null,
    fx_effective: null,
    fx_mode: null,
    fx_note: null,
  };
  if (currency !== "USD") {
    if (unit !== "USD") throw new CurrencyError("a non-USD currency is only valid with --from USD");
    if (!fx) throw new PriceNotFoundError(`no FX data loaded for ${currency}`);
    const got = resolveFx(fx, currency, period, today);
    usdAmount = amount * got.rate;
    fxOut = {
      fx_rate: got.rate,
      fx_effective: got.effective,
      fx_mode: got.mode,
      fx_note: got.note,
    };
  }
  const oz = toOz(usdAmount, unit, price);
  const out = fromOz(oz, price);
  return {
    input: { amount, unit, currency, period: info.effective, granularity: info.granularity },
    effective: info.effective,
    granularity: info.granularity,
    points: info.points,
    gold_usd_per_oz: price,
    price_source: source,
    note,
    troy_oz: oz,
    GB: out.GB,
    GBD: out.GBD,
    USD: out.USD,
    ...fxOut,
    gold_mode: gauge ? gauge.gold_mode : "spot",
    ma_years: gauge ? gauge.ma_years : null,
    ma_months: gauge ? gauge.ma_months : null,
    spot_usd_per_oz: info.price,
    price_note: note,
    price_points: info.points,
  };
}

export interface Query {
  amount: string | number;
  date: string;
  from?: string;
  /** Currency of the amount (default USD); needs `fx` unless USD. */
  currency?: string;
  fx?: FxRates;
  /** Trailing window. Accepts `5y` / `10y` / `20y` or the year count. */
  smooth?: SmoothYears | string;
  today: CivilDate;
}

/** `5y`, `10y`, or `20y` (case-insensitive), matching the CLI. */
export function parseSmooth(text: string): SmoothYears {
  const match = /^(5|10|20)y$/i.exec(text.trim());
  if (!match) throw new Error("--smooth must be 5y, 10y, or 20y");
  return Number(match[1]) as SmoothYears;
}

/**
 * Parse and convert one (amount, date) query the way the CLI does, including the
 * future-date rule. Throws AmountParseError, DateParseError, FutureDateError,
 * UnitParseError, CurrencyParseError, CurrencyError, or PriceNotFoundError.
 */
export function convertQuery(table: GoldTable, query: Query): ConversionResult {
  const unit = parseUnit(query.from ?? "USD");
  const currency = parseCurrency(query.currency ?? "USD");
  const amount = typeof query.amount === "number" ? query.amount : parseAmount(query.amount);
  const period = parseDate(query.date, query.today);
  checkNotFuture(period.anchor, query.date, query.today);
  const smooth =
    query.smooth === undefined
      ? undefined
      : typeof query.smooth === "number"
        ? query.smooth
        : parseSmooth(query.smooth);
  return convert(table, amount, unit, period, query.today, currency, query.fx, smooth);
}
