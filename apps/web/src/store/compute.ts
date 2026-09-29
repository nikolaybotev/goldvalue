import {
  AmountParseError,
  type CivilDate,
  type ConversionResult,
  checkNotFuture,
  convert,
  DateParseError,
  FutureDateError,
  type GoldTable,
  type Period,
  PriceNotFoundError,
  parseAmount,
  parseDate,
} from "@goldvalue/core";
import type { Row } from "./rows-logic";

export interface RowErrors {
  amount?: string;
  date?: string;
}

/** What one sheet row shows. `incomplete` is a neutral hint, not an error. */
export type RowResult =
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "incomplete"; hint: string }
  | { status: "error"; errors: RowErrors }
  | { status: "ok"; conversion: ConversionResult; period: Period; amount: number };

export const FUTURE_DATE_MESSAGE = "date is in the future";

function dateMessage(error: unknown): string {
  if (error instanceof FutureDateError) return FUTURE_DATE_MESSAGE;
  if (error instanceof DateParseError)
    return "unrecognised date (try 2018-12, 2018-12-05, or Mar 2018)";
  throw error;
}

export function computeRow(row: Row, table: GoldTable | null, today: CivilDate): RowResult {
  const amountText = row.amount.trim();
  const dateText = row.date.trim();
  if (amountText === "" && dateText === "") return { status: "empty" };
  if (table === null) return { status: "unavailable" };

  const errors: RowErrors = {};
  let amount: number | undefined;
  let period: Period | undefined;
  if (amountText !== "") {
    try {
      amount = parseAmount(amountText);
    } catch (error) {
      if (!(error instanceof AmountParseError)) throw error;
      errors.amount = "invalid amount";
    }
  }
  if (dateText !== "") {
    try {
      period = parseDate(dateText, today);
      checkNotFuture(period.anchor, dateText, today);
    } catch (error) {
      errors.date = dateMessage(error);
      period = undefined;
    }
  }
  if (errors.amount || errors.date) return { status: "error", errors };
  if (amount === undefined) return { status: "incomplete", hint: "enter an amount" };
  if (period === undefined) return { status: "incomplete", hint: "enter a date" };
  try {
    return {
      status: "ok",
      conversion: convert(table, amount, "USD", period, today),
      period,
      amount,
    };
  } catch (error) {
    if (error instanceof PriceNotFoundError) {
      return { status: "error", errors: { date: "no gold price data for this date" } };
    }
    throw error;
  }
}
