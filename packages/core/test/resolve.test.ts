import { describe, expect, test } from "vitest";
import {
  fmean,
  GoldTable,
  type PriceInfo,
  PriceNotFoundError,
  priceForDay,
  priceForMonth,
  priceForYear,
  resolve,
} from "../src/index";
import { day } from "./support";

// Same hand-made tables as tests/python/conftest.py (not real LBMA data).
const DAILY: [string, number][] = [
  ["1968-01-02", 35.18],
  ["1968-01-03", 35.2],
  ["1968-03-14", 38],
  ["1968-04-01", 38.6],
  ["1968-04-02", 38.8],
  ["1980-01-18", 835],
  ["1980-01-21", 850],
  ["1980-01-22", 845],
  ["2018-12-03", 1200],
  ["2018-12-04", 1210],
  ["2018-12-05", 1220],
  ["2026-01-02", 3010],
  ["2026-02-02", 3110],
  ["2026-09-21", 3400],
  ["2026-09-22", 3410],
  ["2026-09-23", 3420],
  ["2026-09-24", 3430],
  ["2026-09-25", 3440],
];
const MONTHLY: [string, number][] = [
  ...Array.from({ length: 12 }, (_, i): [string, number] => [
    `1955-${String(i + 1).padStart(2, "0")}`,
    35,
  ]),
  ...Array.from({ length: 12 }, (_, i): [string, number] => [
    `1965-${String(i + 1).padStart(2, "0")}`,
    i === 5 ? 35.1 : 35,
  ]),
  ...Array.from({ length: 12 }, (_, i): [string, number] => [
    `1968-${String(i + 1).padStart(2, "0")}`,
    38,
  ]),
  ["1980-01", 675],
  ["2018-12", 1250],
  ...Array.from({ length: 8 }, (_, i): [string, number] => [
    `2026-${String(i + 1).padStart(2, "0")}`,
    3200,
  ]),
];
const table = new GoldTable(DAILY, MONTHLY);
const TODAY = day("2026-09-29");

const at = (iso: string): PriceInfo => priceForDay(table, day(iso));

describe("day resolution", () => {
  test("PM fix on the requested date", () => {
    expect(at("1980-01-21")).toEqual({
      price: 850,
      granularity: "day",
      effective: "1980-01-21",
      points: 1,
      source: "LBMA",
      note: "LBMA fix on the requested date",
    });
  });

  test("weekend rolls back", () => {
    for (const d of ["1980-01-19", "1980-01-20"]) {
      const r = at(d);
      expect([r.price, r.effective]).toEqual([835, "1980-01-18"]);
      expect(r.note).toBe(
        `no LBMA fix on ${d} (non-trading day); used previous fix from 1980-01-18`,
      );
    }
  });

  test("exactly nine days back is found; ten falls to the monthly series", () => {
    expect(at("1968-03-23").effective).toBe("1968-03-14");
    const r = at("1968-03-24");
    expect(r).toMatchObject({
      granularity: "month",
      effective: "1968-03",
      price: 38,
      note: "no LBMA fix within 9 days before 1968-03-24; used the monthly price",
    });
  });

  test("after the latest fix", () => {
    expect(at("2026-09-27").note).toBe(
      "no LBMA fix on 2026-09-27 (non-trading day); used previous fix from 2026-09-25",
    );
    expect(at("2026-10-04").effective).toBe("2026-09-25");
    expect(at("2026-10-05")).toEqual({
      price: 3440,
      granularity: "day",
      effective: "2026-09-25",
      points: 1,
      source: "LBMA",
      note: "requested date is after the latest available fix; used 2026-09-25",
    });
  });

  test("before 1968 uses the monthly series, with the right source label", () => {
    expect(at("1965-06-15")).toEqual({
      price: 35.1,
      granularity: "month",
      effective: "1965-06",
      points: 1,
      source: "World Bank Pink Sheet (monthly)",
      note: "no daily data before 1968; used the monthly price",
    });
    expect(at("1955-07-04").source).toBe("Timothy Green / NMA table (annual average)");
  });

  test("no data raises", () => {
    expect(() => at("1800-01-01")).toThrow(PriceNotFoundError);
    expect(() => at("1990-05-05")).toThrow(PriceNotFoundError);
    expect(() => at("1967-12-31")).toThrow(PriceNotFoundError);
  });
});

describe("month and year resolution", () => {
  test("month mean, and month-to-date follows today", () => {
    const r = priceForMonth(table, 2018, 12, TODAY);
    expect(r.price).toBeCloseTo(1210, 10);
    expect([r.points, r.note]).toEqual([3, "average of 3 LBMA daily fixes"]);
    expect(priceForMonth(table, 2026, 9, TODAY).note).toBe(
      "average of 5 LBMA daily fixes (month to date)",
    );
    expect(priceForMonth(table, 2026, 9, day("2026-10-01")).note).toBe(
      "average of 5 LBMA daily fixes",
    );
  });

  test("month before daily data uses the monthly series", () => {
    expect(priceForMonth(table, 1965, 6, TODAY)).toEqual({
      price: 35.1,
      granularity: "month",
      effective: "1965-06",
      points: 1,
      source: "World Bank Pink Sheet (monthly)",
      note: "monthly series value",
    });
    expect(() => priceForMonth(table, 1900, 1, TODAY)).toThrow(PriceNotFoundError);
  });

  test("year mean, year-to-date follows today", () => {
    const r = priceForYear(table, 2026, TODAY);
    expect(r.points).toBe(7);
    expect(r.price).toBe(fmean([3010, 3110, 3400, 3410, 3420, 3430, 3440]));
    expect(r.note).toBe("average of 7 LBMA daily fixes (year to date)");
    expect(priceForYear(table, 2026, day("2027-01-02")).note).toBe("average of 7 LBMA daily fixes");
  });

  test("year before 1968 averages monthly values", () => {
    const r = priceForYear(table, 1965, TODAY);
    expect(r.points).toBe(12);
    expect(r.note).toBe("average of 12 monthly values");
    expect(r.price).toBeCloseTo((11 * 35 + 35.1) / 12, 12);
    expect(() => priceForYear(table, 1800, TODAY)).toThrow(PriceNotFoundError);
  });

  test("resolve dispatches on kind", () => {
    expect(resolve(table, { kind: "day", anchor: day("1980-01-21") }, TODAY).granularity).toBe(
      "day",
    );
    expect(resolve(table, { kind: "month", anchor: day("1980-01-01") }, TODAY).granularity).toBe(
      "month",
    );
    expect(resolve(table, { kind: "year", anchor: day("1980-01-01") }, TODAY).granularity).toBe(
      "year",
    );
  });
});

describe("daily table not loaded (monthly precision, spec 6.3)", () => {
  const monthlyOnly = new GoldTable([], MONTHLY);

  test("LBMA-era queries fall back to the monthly series and say so", () => {
    expect(priceForDay(monthlyOnly, day("1980-01-21"))).toMatchObject({
      price: 675,
      effective: "1980-01",
      note: "daily LBMA prices not loaded; used the monthly price",
    });
    expect(priceForMonth(monthlyOnly, 1980, 1, TODAY).note).toBe(
      "monthly series value; daily LBMA prices not loaded",
    );
    expect(priceForYear(monthlyOnly, 1968, TODAY).note).toBe(
      "average of 12 monthly values; daily LBMA prices not loaded",
    );
  });

  test("pre-1968 queries are unaffected", () => {
    expect(priceForDay(monthlyOnly, day("1965-06-15")).note).toBe(
      "no daily data before 1968; used the monthly price",
    );
    expect(priceForMonth(monthlyOnly, 1965, 6, TODAY).note).toBe("monthly series value");
    expect(priceForYear(monthlyOnly, 1965, TODAY).note).toBe("average of 12 monthly values");
  });
});

describe("table construction", () => {
  test("unsorted and duplicate daily entries", () => {
    const t = new GoldTable(
      [
        ["2000-01-05", 2],
        ["2000-01-04", 1],
        ["2000-01-05", 3],
      ],
      [],
    );
    expect(t.dailyDates).toEqual(["2000-01-04", "2000-01-05"]);
    expect(t.dailyValue("2000-01-05")).toBe(3);
    expect(t.lastDaily).toBe("2000-01-05");
    expect(t.dailyBetween("2000-01-01", "2000-01-04")).toEqual([1]);
  });

  test("fromCsv reads CRLF files, PM else AM, and normalises month keys", () => {
    const t = GoldTable.fromCsv(
      "date,usd_am,usd_pm\r\n2000-01-04,282.00,\r\n2000-01-05,283.50,284.00\r\n2000-01-06,,\r\n",
      "month,usd\r\n2000-1,284.00\r\n",
    );
    expect(t.dailyDates).toEqual(["2000-01-04", "2000-01-05"]);
    expect(t.dailyValue("2000-01-05")).toBe(284);
    expect(t.monthlyValue(2000, 1)).toBe(284);
    expect(GoldTable.fromCsv(null, "month,usd\n2000-01,1\n").hasDaily).toBe(false);
  });
});
