import { parseAmount } from "./amounts";
import { type CivilDate, checkNotFuture, type Period, type PeriodKind, parseDate } from "./dates";
import { resolve } from "./resolve";
import type { GoldTable } from "./table";
import { fromOz, parseUnit, toOz, type Unit } from "./units";

/** Result of one conversion; the keys and meanings are the CLI's `--json` output. */
export interface ConversionResult {
  input: { amount: number; unit: Unit; period: string; granularity: PeriodKind };
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
  fx_rate: null;
  fx_effective: null;
  fx_mode: null;
  fx_note: null;
  price_note: string;
  price_points: number;
}

/** Port of `convert`: resolve the price for `period` and convert `amount` (in `unit`). */
export function convert(
  table: GoldTable,
  amount: number,
  unit: Unit,
  period: Period,
  today: CivilDate,
): ConversionResult {
  const info = resolve(table, period, today);
  const oz = toOz(amount, unit, info.price);
  const out = fromOz(oz, info.price);
  return {
    input: { amount, unit, period: info.effective, granularity: info.granularity },
    effective: info.effective,
    granularity: info.granularity,
    points: info.points,
    gold_usd_per_oz: info.price,
    price_source: info.source,
    note: info.note,
    troy_oz: oz,
    GB: out.GB,
    GBD: out.GBD,
    USD: out.USD,
    fx_rate: null,
    fx_effective: null,
    fx_mode: null,
    fx_note: null,
    price_note: info.note,
    price_points: info.points,
  };
}

export interface Query {
  amount: string | number;
  date: string;
  from?: string;
  today: CivilDate;
}

/**
 * Parse and convert one (amount, date) query the way the CLI does, including the
 * future-date rule. Throws AmountParseError, DateParseError, FutureDateError,
 * UnitParseError, or PriceNotFoundError.
 */
export function convertQuery(table: GoldTable, query: Query): ConversionResult {
  const unit = parseUnit(query.from ?? "USD");
  const amount = typeof query.amount === "number" ? query.amount : parseAmount(query.amount);
  const period = parseDate(query.date, query.today);
  checkNotFuture(period.anchor, query.date, query.today);
  return convert(table, amount, unit, period, query.today);
}
