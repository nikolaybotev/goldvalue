import { describe, expect, test } from "vitest";
import { DataCsvError, fmean, fsum, parseDataCsv } from "../src/index";

describe("parseDataCsv", () => {
  const columns = ["date", "usd_am", "usd_pm"];

  test("LF and CRLF give identical rows", () => {
    const lf = "date,usd_am,usd_pm\n2000-01-04,282.00,\n2000-01-05,283.50,284.00\n";
    const crlf = lf.replaceAll("\n", "\r\n");
    const expected = [
      ["2000-01-04", "282.00", ""],
      ["2000-01-05", "283.50", "284.00"],
    ];
    expect(parseDataCsv(lf, columns)).toEqual(expected);
    expect(parseDataCsv(crlf, columns)).toEqual(expected);
  });

  test("no trailing newline, blank lines, BOM, extra columns, reordered columns", () => {
    expect(
      parseDataCsv("\ufeffmonth,usd\r\n\r\n1955-01,35.00\r\n\r\n1955-02,35.00", ["month", "usd"]),
    ).toEqual([
      ["1955-01", "35.00"],
      ["1955-02", "35.00"],
    ]);
    expect(parseDataCsv("x,usd,month\n1,35.0,1955-01\n", ["month", "usd"])).toEqual([
      ["1955-01", "35.0"],
    ]);
  });

  test("header-only file yields no rows", () => {
    expect(parseDataCsv("month,usd\n", ["month", "usd"])).toEqual([]);
  });

  test("errors", () => {
    expect(() => parseDataCsv("", columns)).toThrow(DataCsvError);
    expect(() => parseDataCsv("date,usd_am\n", columns)).toThrow("usd_pm");
    expect(() => parseDataCsv("month,usd\n1955-01\n", ["month", "usd"])).toThrow("line 2");
  });
});

describe("fsum / fmean (ports of math.fsum / statistics.fmean)", () => {
  test("exactly rounded where naive summation is not", () => {
    expect(fsum(Array(10).fill(0.1))).toBe(1);
    expect(0.1 * 10).toBe(1);
    expect(
      Array(10)
        .fill(0.1)
        .reduce((a: number, b: number) => a + b, 0),
    ).not.toBe(1);
    expect(fsum([1e16, 1, -1e16])).toBe(1);
    expect(fsum([])).toBe(0);
    expect(fsum([3.5])).toBe(3.5);
  });

  test("fmean", () => {
    expect(fmean([1, 2, 3, 4])).toBe(2.5);
  });
});
