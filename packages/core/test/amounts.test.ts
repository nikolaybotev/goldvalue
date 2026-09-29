import { describe, expect, test } from "vitest";
import {
  AmountParseError,
  fromOz,
  GB_PER_OZ,
  GBD_PER_OZ,
  parseAmount,
  parseUnit,
  toOz,
} from "../src/index";

describe("parseAmount (mirrors tests/python/test_parsing.py)", () => {
  test.each([
    ["1500", 1500],
    ["$1,500", 1500],
    ["1,500.50", 1500.5],
    ["-1,500", -1500],
    ["-$1,500", -1500],
    ["$-1,500", -1500],
    ["+7", 7],
    [".5", 0.5],
    ["5.", 5],
    ["0", 0],
    ["1_000", 1000],
    ["  42  ", 42],
    ["$1,234,567.89", 1234567.89],
    ["\u001c42\u001f", 42],
  ])("accepts %j", (text, value) => {
    expect(parseAmount(text)).toBe(value);
  });

  test.each([
    "",
    "abc",
    "nan",
    "NaN",
    "inf",
    "-inf",
    "Infinity",
    "1e3",
    "1E3",
    "2.5e-3",
    "1e400",
    "1".repeat(400),
    "1.2.3",
    "--5",
    "+-5",
    "$",
    "-",
    ".",
    "1 500",
    "0x10",
    "１２３",
    "\ufeff5",
  ])("rejects %j", (text) => {
    expect(() => parseAmount(text)).toThrow(AmountParseError);
  });

  test("null and undefined are invalid", () => {
    expect(() => parseAmount(null)).toThrow(AmountParseError);
    expect(() => parseAmount(undefined)).toThrow(AmountParseError);
  });
});

describe("units", () => {
  test("constants", () => {
    expect(GB_PER_OZ).toBe(1000);
    expect(GBD_PER_OZ).toBe(50);
  });

  test.each([
    ["usd", "USD"],
    ["$", "USD"],
    ["GB", "GB"],
    ["goldbacks", "GB"],
    ["gbd", "GBD"],
    ["Gold-Backed-Dollar", "GBD"],
    ["oz", "OZ"],
    ["troy oz", "OZ"],
    ["ounces", "OZ"],
  ])("parseUnit(%j)", (text, unit) => {
    expect(parseUnit(text)).toBe(unit);
  });

  test("parseUnit rejects unknown names, including prototype keys", () => {
    expect(() => parseUnit("eur")).toThrow();
    expect(() => parseUnit("constructor")).toThrow();
    expect(() => parseUnit("__proto__")).toThrow();
  });

  test("conversions", () => {
    expect(toOz(1000, "USD", 850)).toBe(1000 / 850);
    expect(toOz(1000, "GB", 850)).toBe(1);
    expect(toOz(50, "GBD", 850)).toBe(1);
    expect(toOz(2.5, "OZ", 850)).toBe(2.5);
    expect(fromOz(2, 850)).toEqual({ USD: 1700, GB: 2000, GBD: 100, OZ: 2 });
  });
});
