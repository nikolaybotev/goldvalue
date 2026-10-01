import { describe, expect, test } from "vitest";
import {
  batchLayout,
  COMPUTED_COLUMNS,
  CsvFormatError,
  exportCsv,
  FIXED_COLUMNS,
  formatFixed,
  importCsv,
  parseUnit,
  quoteField,
  runBatch,
} from "../src/index";
import { day, loadSnapshotFx, loadSnapshotTable, readVectorBytes, readVectorFile } from "./support";

const table = loadSnapshotTable();
const fx = loadSnapshotFx();
const today = day("2026-09-29");

const decode = (bytes: Buffer): string => bytes.toString("utf8");

describe("batch vectors written by goldvalue.py --batch", () => {
  test.each(["basic", "legacy", "crlf", "dedupe"])(
    "%s: TypeScript output is byte-identical",
    (stem) => {
      const input = decode(readVectorBytes(`batch-${stem}-in.csv`));
      const expected = decode(readVectorBytes(`batch-${stem}-out.csv`));
      const result = runBatch(input, table, { today });
      expect(result.errors).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.csv).toBe(expected);
    },
  );

  test.each(["basic", "legacy", "crlf", "dedupe"])(
    "%s: output re-imports unchanged (AC3)",
    (stem) => {
      const output = decode(readVectorBytes(`batch-${stem}-out.csv`));
      expect(runBatch(output, table, { today }).csv).toBe(output);
    },
  );

  test("the CRLF+BOM input really has those bytes", () => {
    const bytes = readVectorBytes("batch-crlf-in.csv");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decode(bytes)).toContain("\r\n");
  });
});

describe("batch-fx-eur vector written by goldvalue.py --batch --currency EUR", () => {
  const input = decode(readVectorBytes("batch-fx-eur-in.csv"));
  const expected = decode(readVectorBytes("batch-fx-eur-out.csv"));

  test("TypeScript output is byte-identical", () => {
    const result = runBatch(input, table, { today, currency: "EUR", fx });
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.csv).toBe(expected);
  });

  test("output re-imports unchanged in the same currency (AC3)", () => {
    const again = runBatch(expected, table, { today, currency: "EUR", fx });
    expect(again.warnings).toEqual([]);
    expect(again.csv).toBe(expected);
  });

  test("the currency column carries the sheet currency and fx_* are filled", () => {
    const [header, ...rows] = expected.trimEnd().split("\n");
    expect(header).toContain(",currency,");
    expect(rows[0]).toContain(",EUR,");
    expect(
      header?.endsWith(
        "fx_rate,fx_effective,fx_mode,fx_note,gold_mode,ma_years,ma_months,spot_usd_per_oz",
      ),
    ).toBe(true);
  });

  test("USD rows keep empty fx columns and a non-USD --from unit still names the currency", () => {
    const usd = runBatch("date,amount\n1980-01-21,850\n", table, { today });
    const usdCols = usd.csv.split("\n")[0]?.split(",") ?? [];
    const usdFields = usd.csv.trimEnd().split("\n")[1]?.split(",") ?? [];
    expect(usdFields[usdCols.indexOf("gold_mode")]).toBe("spot");
    expect(usdFields[usdCols.indexOf("ma_years")]).toBe("");
    expect(usdFields[usdCols.indexOf("ma_months")]).toBe("");
    expect(usdFields[usdCols.indexOf("spot_usd_per_oz")]).toBe(
      usdFields[usdCols.indexOf("gold_usd_per_oz")],
    );
    const gb = runBatch("date,amount\n1980-01-21,850\n", table, { today, unit: "GB" });
    expect(gb.csv.split("\n")[1]?.split(",")[2]).toBe("GB");
  });

  test("a currency other than USD without FX tables is a price-not-found skip", () => {
    const result = runBatch("date,amount\n1980-01-21,850\n", table, { today, currency: "GBP" });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.message).toContain("no FX data loaded for GBP");
  });
});

describe("importCsv currency column (FR14)", () => {
  const body = (values: string[]) =>
    `date,amount,currency\n${values.map((c) => `1980-01-21,1,${c}`).join("\n")}\n`;

  test("a currency column that differs from the sheet currency warns once", () => {
    const r = importCsv(body(["GBP", "EUR", "GBP"]), today, "EUR");
    expect(r.warnings).toEqual([
      "The file's currency column (GBP) differs from the sheet currency EUR; EUR is applied to every row.",
    ]);
    expect(r.rows).toHaveLength(3);
    expect(r.columns).toEqual([]);
  });

  test("matching, empty, lower-case and absent currency values do not warn", () => {
    expect(importCsv(body(["USD", "usd", ""]), today).warnings).toEqual([]);
    expect(importCsv(body(["eur"]), today, "EUR").warnings).toEqual([]);
    expect(importCsv("date,amount\n1980-01-21,1\n", today, "EUR").warnings).toEqual([]);
  });

  test("the warning lists every differing value", () => {
    const r = importCsv(body(["GBP", "CHF"]), today);
    expect(r.warnings[0]).toContain("(GBP, CHF)");
    expect(r.warnings[0]).toContain("sheet currency USD");
  });
});

describe("importCsv", () => {
  test("layout: aliases, label, passthrough, and columns ignored on import", () => {
    const r = importCsv(
      "Period,USD,Label,Region,effective,currency\n1980-01-21,850,x,west,zzz,EUR\n",
      today,
    );
    expect(r.columns).toEqual(["Region"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      date: "1980-01-21",
      amount: "850",
      label: "x",
      extra: ["west"],
      line: 2,
    });
  });

  test("errors are per line and valid lines still load (FR16)", () => {
    const text = [
      "date,amount",
      "1980-01-21,850",
      "nope,1",
      "1980-01-21,1e3",
      "2027,5",
      "1980-01-21",
      "",
      "2018-12,100",
    ].join("\n");
    const r = importCsv(text, today);
    expect(r.rows.map((row) => row.line)).toEqual([2, 8]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[0]?.message).toContain("unrecognised date");
    expect(r.errors[1]?.message).toContain("invalid amount");
    expect(r.errors[2]?.message).toContain("date is in the future");
  });

  test("line numbers count physical lines, ending where a multi-line record ends", () => {
    const r = importCsv('date,amount,label\n1980-01-21,850,"two\nlines"\nbad,1,x\n', today);
    expect(r.rows[0]?.line).toBe(3);
    expect(r.errors).toEqual([{ line: 4, message: expect.stringContaining("unrecognised date") }]);
    const crlf = importCsv("date,amount\r\n1980-01-21,850\r\nbad,1\r\n", today);
    expect(crlf.errors[0]?.line).toBe(3);
    const noFinalNewline = importCsv("date,amount\n1980-01-21,850\nbad,1", today);
    expect(noFinalNewline.errors[0]?.line).toBe(3);
  });

  test("BOM, quoting and blank lines", () => {
    const r = importCsv('\ufeffdate,amount,label\n\n"Jan 21, 1980","$1,000","a ""q"" b"\n', today);
    expect(r.rows[0]).toMatchObject({
      date: "Jan 21, 1980",
      amount: "$1,000",
      label: 'a "q" b',
      value: 1000,
    });
  });

  test("format errors", () => {
    expect(() => importCsv("", today)).toThrow(CsvFormatError);
    expect(() => importCsv("when,how much\n1,2\n", today)).toThrow(
      "'date' column and an 'amount' column",
    );
    expect(() => importCsv("date,troy_oz,USD\n1980-01-21,1,850\n", today)).toThrow(CsvFormatError);
  });

  test("header-only file yields no rows", () => {
    expect(importCsv("date,amount\n", today)).toEqual({
      columns: [],
      rows: [],
      errors: [],
      warnings: [],
    });
  });
});

describe("batchLayout (dedupe rule)", () => {
  test("first duplicate name wins, case-insensitively", () => {
    const layout = batchLayout(["date", "Amount", "region", "Region", "DATE", "amount"]);
    expect([layout.dateIndex, layout.amountIndex]).toEqual([0, 1]);
    expect(layout.passthrough).toEqual([{ name: "region", index: 2 }]);
  });

  test("passthrough names that collide with output columns are dropped", () => {
    const layout = batchLayout([
      "date",
      "amount",
      "USD",
      "Note",
      "GB",
      "granularity",
      "keep",
      "Label",
    ]);
    expect(layout.passthrough.map((c) => c.name)).toEqual(["keep"]);
    expect(layout.labelIndex).toBe(7);
  });

  test("USD is an amount alias unless the header looks like an export", () => {
    expect(batchLayout(["date", "USD", "memo"]).amountIndex).toBe(1);
    expect(() => batchLayout(["date", "USD", "troy_oz"])).toThrow(CsvFormatError);
    expect(batchLayout(["date", "amount", "USD", "troy_oz"]).amountIndex).toBe(1);
  });

  test("aliases in priority order", () => {
    expect(batchLayout(["year", "date", "price", "amount"])).toMatchObject({
      dateIndex: 1,
      amountIndex: 3,
    });
    expect(batchLayout(["Month", "VALUE"])).toMatchObject({ dateIndex: 0, amountIndex: 1 });
  });

  test("reserved names cover the FR15 schema", () => {
    expect(FIXED_COLUMNS).toEqual(["date", "amount", "currency", "label"]);
    expect(COMPUTED_COLUMNS).toHaveLength(17);
    expect(COMPUTED_COLUMNS[0]).toBe("effective");
    expect(COMPUTED_COLUMNS.at(-5)).toBe("fx_note");
    expect(COMPUTED_COLUMNS.slice(-4)).toEqual([
      "gold_mode",
      "ma_years",
      "ma_months",
      "spot_usd_per_oz",
    ]);
  });
});

describe("export formatting", () => {
  test("formatFixed matches Python's format (exact ties round to even)", () => {
    expect(formatFixed(0.125, 2)).toBe("0.12");
    expect(formatFixed(0.375, 2)).toBe("0.38");
    expect(formatFixed(-0.125, 2)).toBe("-0.12");
    expect(formatFixed(2.5, 0)).toBe("2");
    expect(formatFixed(0.0000004, 6)).toBe("0.000000");
    expect(formatFixed(1e-6, 6)).toBe("0.000001");
    expect(formatFixed(-1e-7, 2)).toBe("-0.00");
    expect(formatFixed(0, 2)).toBe("0.00");
    expect(formatFixed(12345678.9, 2)).toBe("12345678.90");
    expect(formatFixed(1e21, 2)).toBe("1000000000000000000000.00");
    expect(() => formatFixed(Number.NaN, 2)).toThrow(RangeError);
  });

  test("quoteField follows QUOTE_MINIMAL", () => {
    expect(quoteField("plain")).toBe("plain");
    expect(quoteField("a,b")).toBe('"a,b"');
    expect(quoteField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteField("two\nlines")).toBe('"two\nlines"');
    expect(quoteField("")).toBe("");
  });

  test("exportCsv header and LF endings", () => {
    const csv = exportCsv(["Region"], []);
    expect(csv).toBe(`${[...FIXED_COLUMNS, "Region", ...COMPUTED_COLUMNS].join(",")}\n`);
  });
});

describe("runBatch", () => {
  test("rows without price data are skipped and reported", () => {
    const r = runBatch("date,amount\n1800-01-01,1\n1980-01-21,850\n", table, { today });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ line: 2 });
    expect(r.csv.trim().split("\n")).toHaveLength(2);
  });

  test("non-USD units are named in the currency column", () => {
    const r = runBatch("date,amount\n1980-01-21,100\n", table, { today, unit: parseUnit("GB") });
    const row = r.csv.trim().split("\n")[1] as string;
    expect(row.split(",")[2]).toBe("GB");
  });

  test("the vector input file is read from disk as committed", () => {
    expect(readVectorFile("batch-basic-in.csv")).toContain("café");
  });
});
