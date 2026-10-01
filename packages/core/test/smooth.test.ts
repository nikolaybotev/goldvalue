import { describe, expect, test } from "vitest";
import {
  CurrencyError,
  convert,
  convertQuery,
  GoldTable,
  type MonthlyEntry,
  PriceNotFoundError,
  runBatch,
} from "../src/index";
import { day, loadSnapshotTable } from "./support";

const TODAY = day("2026-09-29");
const HOLE_NOTE = "5-year average; 59 months, 2010-01 to 2014-12; missing 2012-06";
const FULL_NOTE = "10-year average; 120 months, 2016-10 to 2026-09";
const PARTIAL_NOTE = "10-year average; 48 months, 1833-01 to 1836-12; series starts 1833-01";

function shift(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

function monthSpan(
  start: [number, number],
  end: [number, number],
  price = 10,
  skip: string[] = [],
): MonthlyEntry[] {
  const out: MonthlyEntry[] = [];
  let [year, month] = start;
  const [endYear, endMonth] = end;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const label = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (!skip.includes(label)) out.push([label, price]);
    [year, month] = shift(year, month, 1);
  }
  return out;
}

function tableOf(monthly: MonthlyEntry[], daily: [string, number][] = []): GoldTable {
  return new GoldTable(daily, monthly);
}

describe("trailing average", () => {
  test("an interior hole is labeled and an empty window errors, on a tiny table", () => {
    // A later fix keeps the daily table non-empty, so this note is not the
    // not-loaded path. The fix sits outside both spans.
    const table = tableOf(monthSpan([2010, 1], [2014, 12], 10, ["2012-06"]), [["2020-01-02", 10]]);
    expect(table.seriesStart).toBe("2010-01");
    const result = convert(
      table,
      1000,
      "USD",
      { kind: "month", anchor: day("2014-12-01") },
      TODAY,
      "USD",
      undefined,
      5,
    );
    expect(result.gold_mode).toBe("partial");
    expect(result.ma_years).toBe(5);
    expect(result.ma_months).toBe(59);
    expect(result.note).toBe(HOLE_NOTE);
    expect(result.gold_usd_per_oz).toBe(10);
    expect(() =>
      convert(
        table,
        1,
        "USD",
        { kind: "month", anchor: day("2000-06-01") },
        TODAY,
        "USD",
        undefined,
        5,
      ),
    ).toThrow(PriceNotFoundError);
    expect(() =>
      convert(
        table,
        1,
        "USD",
        { kind: "month", anchor: day("2000-06-01") },
        TODAY,
        "USD",
        undefined,
        5,
      ),
    ).toThrow("no gold price data for the 5-year span ending 2000-06");
  });

  test("the clipped last month is computed per query and the full-month cache stays", () => {
    const monthly = monthSpan([2005, 5], [2010, 3]);
    monthly.push(["2010-04", 999]);
    const table = tableOf(monthly, [
      ["2010-04-01", 100],
      ["2010-04-02", 200],
      ["2010-04-03", 600],
    ]);
    const stored = table.monthQuote(2010, 4);
    expect(stored?.price).toBe(300);
    expect(stored?.source).toBe("LBMA");
    expect(table.monthlyValue(2010, 4)).toBe(999);
    const today = day("2010-04-02");
    const clipped = convert(
      table,
      1000,
      "USD",
      { kind: "day", anchor: day("2010-04-02") },
      today,
      "USD",
      undefined,
      5,
    );
    expect(clipped.note).toContain(" (month to date)");
    expect(clipped.note.startsWith("5-year average; 60 months, 2005-05 to 2010-04")).toBe(true);
    const full = convert(
      table,
      1000,
      "USD",
      { kind: "month", anchor: day("2010-04-01") },
      today,
      "USD",
      undefined,
      5,
    );
    expect(full.note).not.toContain("(month to date)");
    expect(full.gold_usd_per_oz).not.toBe(clipped.gold_usd_per_oz);
    expect(table.monthQuote(2010, 4)?.price).toBe(300);
    expect(table.monthlyValue(2010, 4)).toBe(999);
    const end = convert(
      table,
      1000,
      "USD",
      { kind: "day", anchor: day("2010-04-03") },
      day("2010-04-03"),
      "USD",
      undefined,
      5,
    );
    expect(end.note).not.toContain("(month to date)");
    expect(end.gold_usd_per_oz).toBe(full.gold_usd_per_oz);
  });

  test("a year in progress ends at the current month and a completed year ends in December", () => {
    const table = tableOf(monthSpan([2005, 1], [2010, 12]), [["1990-01-02", 10]]);
    const mid = convert(
      table,
      1,
      "USD",
      { kind: "year", anchor: day("2010-01-01") },
      day("2010-06-15"),
      "USD",
      undefined,
      5,
    );
    expect(mid.note).toBe("5-year average; 60 months, 2005-07 to 2010-06");
    expect(mid.note).not.toContain("(month to date)");
    const done = convert(
      table,
      1,
      "USD",
      { kind: "year", anchor: day("2010-01-01") },
      day("2011-02-01"),
      "USD",
      undefined,
      5,
    );
    expect(done.note).toBe("5-year average; 60 months, 2006-01 to 2010-12");
  });

  test("negative amounts keep their sign", () => {
    const table = tableOf(monthSpan([2010, 1], [2014, 12]));
    const result = convert(
      table,
      -1000,
      "USD",
      { kind: "month", anchor: day("2014-12-01") },
      TODAY,
      "USD",
      undefined,
      5,
    );
    expect(result.gold_mode).toBe("smoothed");
    expect(result.troy_oz).toBeLessThan(0);
    expect(result.GB).toBeLessThan(0);
    expect(result.USD).toBeLessThan(0);
  });

  test("an empty daily table says prices are not loaded once, and only from 1968", () => {
    const through1968 = tableOf(monthSpan([1964, 1], [1968, 12], 35));
    const loaded = convert(
      through1968,
      1000,
      "USD",
      { kind: "month", anchor: day("1968-12-01") },
      TODAY,
      "USD",
      undefined,
      5,
    );
    expect(loaded.note).toBe(
      "5-year average; 60 months, 1964-01 to 1968-12; daily LBMA prices not loaded",
    );
    expect(loaded.note.match(/daily LBMA prices not loaded/g)).toHaveLength(1);
    expect(loaded.price_source).toBe("World Bank Pink Sheet (monthly)");
    const before = tableOf(monthSpan([1963, 1], [1967, 12], 35));
    const early = convert(
      before,
      1000,
      "USD",
      { kind: "month", anchor: day("1967-12-01") },
      TODAY,
      "USD",
      undefined,
      5,
    );
    expect(early.note).toBe("5-year average; 60 months, 1963-01 to 1967-12");
    expect(early.note).not.toContain("daily LBMA prices not loaded");
  });

  test("--smooth is only valid with --from USD", () => {
    const table = tableOf(monthSpan([2010, 1], [2014, 12]));
    expect(() =>
      convert(
        table,
        1,
        "GB",
        { kind: "month", anchor: day("2014-12-01") },
        TODAY,
        "USD",
        undefined,
        5,
      ),
    ).toThrow(CurrencyError);
  });

  test("an empty window skips the batch row and the hole row keeps its note", () => {
    const table = tableOf(monthSpan([2010, 1], [2014, 12], 10, ["2012-06"]), [["2020-01-02", 10]]);
    const result = runBatch("date,amount\n2000-06,1\n2014-12,10\n", table, {
      today: TODAY,
      smooth: 5,
    });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.message).toBe(
      "no gold price data for the 5-year span ending 2000-06",
    );
    expect(result.csv).toContain(HOLE_NOTE);
    expect(result.csv).toContain(",partial,5,59,");
  });
});

describe("fixture windows", () => {
  const table = loadSnapshotTable();

  test("the full window, the 1836 partial, and the series-start bounds", () => {
    const full = convertQuery(table, { amount: 1000, date: "2026-09", today: TODAY, smooth: 10 });
    expect(full.note).toBe(FULL_NOTE);
    expect(full.gold_mode).toBe("smoothed");
    expect(full.ma_months).toBe(120);
    expect(full.price_source).toBe("LBMA");
    const partial = convertQuery(table, {
      amount: 1000,
      date: "1836",
      today: TODAY,
      smooth: "10y",
    });
    expect(partial.gold_mode).toBe("partial");
    expect(partial.note).toBe(PARTIAL_NOTE);
    expect(partial.ma_years).toBe(10);
    expect(partial.ma_months).toBe(48);
    expect(convertQuery(table, { amount: 1, date: "2018-12", today: TODAY, smooth: 10 }).note).toBe(
      "10-year average; 120 months, 2009-01 to 2018-12",
    );
    expect(convertQuery(table, { amount: 1, date: "2018", today: TODAY, smooth: 10 }).note).toBe(
      "10-year average; 120 months, 2009-01 to 2018-12",
    );
    expect(
      convertQuery(table, { amount: 1, date: "1837-11", today: TODAY, smooth: 5 }).gold_mode,
    ).toBe("partial");
    const five = convertQuery(table, { amount: 1, date: "1837-12", today: TODAY, smooth: 5 });
    expect(five.gold_mode).toBe("smoothed");
    expect(five.ma_months).toBe(60);
    expect(
      convertQuery(table, { amount: 1, date: "1842-11", today: TODAY, smooth: 10 }).gold_mode,
    ).toBe("partial");
    const ten = convertQuery(table, { amount: 1, date: "1842-12", today: TODAY, smooth: 10 });
    expect(ten.gold_mode).toBe("smoothed");
    expect(ten.ma_months).toBe(120);
    expect(
      convertQuery(table, { amount: 1, date: "1852-11", today: TODAY, smooth: 20 }).gold_mode,
    ).toBe("partial");
    const twenty = convertQuery(table, { amount: 1, date: "1852-12", today: TODAY, smooth: 20 });
    expect(twenty.gold_mode).toBe("smoothed");
    expect(twenty.ma_months).toBe(240);
    const mixed = convertQuery(table, { amount: 1, date: "1968-12", today: TODAY, smooth: 10 });
    expect(mixed.price_source).toBe("mixed");
    expect(mixed.gold_mode).toBe("smoothed");
    expect(mixed.effective).toBe("1968-12");
    expect(mixed.granularity).toBe("month");
    expect(mixed.spot_usd_per_oz).not.toBe(mixed.gold_usd_per_oz);
  });
});
