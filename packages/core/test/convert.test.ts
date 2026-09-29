import { describe, expect, test } from "vitest";
import {
  AmountParseError,
  convertQuery,
  DateParseError,
  FutureDateError,
  PriceNotFoundError,
  UnitParseError,
} from "../src/index";
import { day, loadSnapshotTable } from "./support";

const table = loadSnapshotTable();
const today = day("2026-09-29");

describe("convertQuery", () => {
  test("result has the CLI --json shape", () => {
    const r = convertQuery(table, { amount: "$1,000", date: "1980-01-21", today });
    expect(Object.keys(r).sort()).toEqual(
      [
        "GB",
        "GBD",
        "USD",
        "effective",
        "fx_effective",
        "fx_mode",
        "fx_note",
        "fx_rate",
        "gold_usd_per_oz",
        "granularity",
        "input",
        "note",
        "points",
        "price_note",
        "price_points",
        "price_source",
        "troy_oz",
      ].sort(),
    );
    expect(r.input).toEqual({
      amount: 1000,
      unit: "USD",
      period: "1980-01-21",
      granularity: "day",
    });
    expect([r.fx_rate, r.fx_effective, r.fx_mode, r.fx_note]).toEqual([null, null, null, null]);
    expect(r.price_note).toBe(r.note);
    expect(r.GB).toBe(r.troy_oz * 1000);
    expect(r.GBD).toBe(r.troy_oz * 50);
  });

  test("units, negatives and the today keyword", () => {
    const gb = convertQuery(table, { amount: "1000", date: "1980-01-21", from: "GB", today });
    expect(gb.troy_oz).toBe(1);
    expect(gb.USD).toBe(gb.gold_usd_per_oz);
    expect(convertQuery(table, { amount: "-5", date: "2018-12", today }).GB).toBeLessThan(0);
    const t = convertQuery(table, { amount: 1, date: "today", today });
    expect(t.effective).toBe("2026-09-25");
    expect(t.note).toContain("non-trading day");
  });

  test("errors", () => {
    expect(() => convertQuery(table, { amount: "nan", date: "2000", today })).toThrow(
      AmountParseError,
    );
    expect(() => convertQuery(table, { amount: "1", date: "yesterday", today })).toThrow(
      DateParseError,
    );
    expect(() => convertQuery(table, { amount: "1", date: "2026-09-30", today })).toThrow(
      FutureDateError,
    );
    expect(() => convertQuery(table, { amount: "1", date: "2027", today })).toThrow(
      FutureDateError,
    );
    expect(() => convertQuery(table, { amount: "1", date: "1800", today })).toThrow(
      PriceNotFoundError,
    );
    expect(() => convertQuery(table, { amount: "1", date: "2000", from: "eur", today })).toThrow(
      UnitParseError,
    );
  });
});
