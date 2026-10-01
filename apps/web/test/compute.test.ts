import { type Currency, FxRates, parseSmooth } from "@goldvalue/core";
import { expect, test } from "vitest";
import { computeRow, FUTURE_DATE_MESSAGE } from "../src/store/compute";
import { newRow } from "../src/store/rows-logic";
import { day, fixtureTable, readVectorFile, vectors } from "./support";

const close = (actual: number, expected: number) => {
  const tolerance = Math.max(Math.abs(expected) * 1e-9, 1e-12);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

test("sheet rows reproduce every USD golden vector", () => {
  const table = fixtureTable();
  let checked = 0;
  for (const vector of vectors()) {
    if (vector.input.from !== "USD") continue;
    const { amount, date, today, smooth } = vector.input;
    const result = computeRow(
      newRow({ amount: String(amount), date }),
      table,
      day(today),
      "USD",
      undefined,
      smooth === undefined ? undefined : parseSmooth(smooth),
    );
    expect(result.status, vector.name).toBe("ok");
    if (result.status !== "ok") continue;
    const { conversion } = result;
    expect(conversion.effective, vector.name).toBe(vector.expected.effective);
    expect(conversion.note, vector.name).toBe(vector.expected.note);
    expect(conversion.price_source, vector.name).toBe(vector.expected.price_source);
    expect(conversion.gold_mode, vector.name).toBe(vector.expected.gold_mode);
    expect(conversion.ma_years, vector.name).toBe(vector.expected.ma_years);
    expect(conversion.ma_months, vector.name).toBe(vector.expected.ma_months);
    close(conversion.GB, vector.expected.GB);
    close(conversion.GBD, vector.expected.GBD);
    close(conversion.troy_oz, vector.expected.troy_oz);
    close(conversion.gold_usd_per_oz, vector.expected.gold_usd_per_oz);
    close(conversion.spot_usd_per_oz, vector.expected.spot_usd_per_oz);
    checked++;
  }
  expect(checked).toBeGreaterThan(60);
});

test("a future date is a row error, other rows are unaffected", () => {
  const table = fixtureTable();
  const today = day("2026-09-29");
  const future = computeRow(newRow({ amount: "100", date: "2030" }), table, today);
  expect(future).toEqual({ status: "error", errors: { date: FUTURE_DATE_MESSAGE } });
  expect(FUTURE_DATE_MESSAGE).toBe("date is in the future");
  expect(computeRow(newRow({ amount: "100", date: "2020" }), table, today).status).toBe("ok");
});

test("amount and date errors are reported together", () => {
  const table = fixtureTable();
  const result = computeRow(newRow({ amount: "abc", date: "someday" }), table, day("2026-09-29"));
  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(result.errors.amount).toMatch(/invalid amount/);
    expect(result.errors.date).toMatch(/unrecognised date/);
  }
});

test("partial and empty rows are neutral", () => {
  const table = fixtureTable();
  const today = day("2026-09-29");
  expect(computeRow(newRow(), table, today)).toEqual({ status: "empty" });
  expect(computeRow(newRow({ amount: "5" }), table, today)).toEqual({
    status: "incomplete",
    hint: "enter a date",
  });
  expect(computeRow(newRow({ date: "2020" }), table, today)).toEqual({
    status: "incomplete",
    hint: "enter an amount",
  });
  expect(computeRow(newRow({ amount: "5", date: "2020" }), null, today)).toEqual({
    status: "unavailable",
  });
});

test("without daily data rows compute from the monthly series and say so", () => {
  const result = computeRow(
    newRow({ amount: "80000", date: "2018-12" }),
    fixtureTable(false),
    day("2026-09-29"),
  );
  expect(result.status).toBe("ok");
  if (result.status === "ok") {
    expect(result.conversion.note).toContain("daily LBMA prices not loaded");
    expect(result.conversion.granularity).toBe("month");
  }
});

test("a non-USD currency without a rate table does not compute", () => {
  const result = computeRow(
    newRow({ amount: "1", date: "2000" }),
    fixtureTable(),
    day("2026-09-29"),
    "EUR",
  );
  expect(result).toEqual({ status: "unavailable", kind: "fx" });
});

test("sheet rows reproduce every FX golden vector", () => {
  const table = fixtureTable();
  const fx = FxRates.fromCsv({
    EUR: readVectorFile("snapshot", "fx_eur.csv"),
    GBP: readVectorFile("snapshot", "fx_gbp.csv"),
    CHF: readVectorFile("snapshot", "fx_chf.csv"),
  });
  const cases = JSON.parse(readVectorFile("fx.json")) as {
    name: string;
    input: { amount: number; currency: Currency; date: string; from: string; today: string };
    expected: {
      effective: string;
      GB: number;
      GBD: number;
      troy_oz: number;
      USD: number;
      fx_mode: string;
      fx_note: string;
      note: string;
    };
  }[];
  expect(cases.length).toBe(129);
  for (const vector of cases) {
    expect(vector.input.from, vector.name).toBe("USD");
    const result = computeRow(
      newRow({ amount: String(vector.input.amount), date: vector.input.date }),
      table,
      day(vector.input.today),
      vector.input.currency,
      fx,
    );
    expect(result.status, vector.name).toBe("ok");
    if (result.status !== "ok") continue;
    const { conversion } = result;
    expect(conversion.fx_mode, vector.name).toBe(vector.expected.fx_mode);
    expect(conversion.fx_note, vector.name).toBe(vector.expected.fx_note);
    expect(conversion.effective, vector.name).toBe(vector.expected.effective);
    expect(conversion.note, vector.name).toBe(vector.expected.note);
    close(conversion.GB, vector.expected.GB);
    close(conversion.GBD, vector.expected.GBD);
    close(conversion.troy_oz, vector.expected.troy_oz);
    close(conversion.USD, vector.expected.USD);
  }
});

test("a non-USD row uses the spot FX rate and the averaged gold price", () => {
  const table = fixtureTable();
  const fx = FxRates.fromCsv({ GBP: readVectorFile("snapshot", "fx_gbp.csv") });
  const result = computeRow(
    newRow({ amount: "1000", date: "1836" }),
    table,
    day("2026-09-29"),
    "GBP",
    fx,
    10,
  );
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  const { conversion } = result;
  expect(conversion.gold_mode).toBe("partial");
  expect(conversion.note).toBe(
    "10-year average; 48 months, 1833-01 to 1836-12; series starts 1833-01",
  );
  expect(conversion.fx_mode).toBe("extrapolated");
  expect(conversion.fx_note).toContain("parity");
  expect(conversion.gold_usd_per_oz).toBe(20.67);
  expect(conversion.GB).toBeGreaterThan(100_000);
});

test("negative amounts compute", () => {
  const result = computeRow(
    newRow({ amount: "-$1,500", date: "1980-01-21" }),
    fixtureTable(),
    day("2026-09-29"),
  );
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.conversion.GB).toBeLessThan(0);
});
