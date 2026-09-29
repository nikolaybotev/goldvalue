import { expect, test } from "vitest";
import { computeRow, FUTURE_DATE_MESSAGE } from "../src/store/compute";
import { newRow } from "../src/store/rows-logic";
import { day, fixtureTable, vectors } from "./support";

const close = (actual: number, expected: number) => {
  const tolerance = Math.max(Math.abs(expected) * 1e-9, 1e-12);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

test("sheet rows reproduce every USD golden vector", () => {
  const table = fixtureTable();
  let checked = 0;
  for (const vector of vectors()) {
    if (vector.input.from !== "USD") continue;
    const { amount, date, today } = vector.input;
    const result = computeRow(newRow({ amount: String(amount), date }), table, day(today));
    expect(result.status, vector.name).toBe("ok");
    if (result.status !== "ok") continue;
    const { conversion } = result;
    expect(conversion.effective, vector.name).toBe(vector.expected.effective);
    expect(conversion.note, vector.name).toBe(vector.expected.note);
    expect(conversion.price_source, vector.name).toBe(vector.expected.price_source);
    close(conversion.GB, vector.expected.GB);
    close(conversion.GBD, vector.expected.GBD);
    close(conversion.troy_oz, vector.expected.troy_oz);
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

test("negative amounts compute", () => {
  const result = computeRow(
    newRow({ amount: "-$1,500", date: "1980-01-21" }),
    fixtureTable(),
    day("2026-09-29"),
  );
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.conversion.GB).toBeLessThan(0);
});
