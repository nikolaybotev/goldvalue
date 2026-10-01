import { CsvFormatError, FxRates } from "@goldvalue/core";
import { expect, test } from "vitest";
import { exportSheet, importSheet, MAX_IMPORT_BYTES } from "../src/io/csv-io";
import { computeRow } from "../src/store/compute";
import { isBlank, newRow, type Row } from "../src/store/rows-logic";
import { day, fixtureTable, readVectorFile } from "./support";

const table = fixtureTable();
const today = day("2026-09-29");
const STEMS = ["basic", "legacy", "crlf", "dedupe"];

/** The sheet's whole CSV path: import, per-row compute, export. */
function throughSheet(text: string) {
  const imported = importSheet(text, today);
  const results = imported.rows.map((row) => computeRow(row, table, today));
  return { imported, exported: exportSheet(imported.rows, results, imported.extraColumns) };
}

test("the size limit is 5 MB", () => {
  expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024);
});

test.each(STEMS)("%s: sheet export equals goldvalue.py --batch output byte for byte", (stem) => {
  const { imported, exported } = throughSheet(readVectorFile(`batch-${stem}-in.csv`));
  expect(imported.errors).toEqual([]);
  expect(exported.skipped).toBe(0);
  expect(exported.csv).toBe(readVectorFile(`batch-${stem}-out.csv`));
});

test.each(STEMS)("%s: export -> import -> export is byte-identical (AC3)", (stem) => {
  const first = throughSheet(readVectorFile(`batch-${stem}-in.csv`)).exported.csv;
  const second = throughSheet(first).exported.csv;
  expect(second).toBe(first);
  expect(throughSheet(second).exported.csv).toBe(first);
});

test("export uses LF endings only, no BOM, and ends with one newline", () => {
  const { csv } = throughSheet(readVectorFile("batch-crlf-in.csv")).exported;
  expect(csv).not.toContain("\r");
  expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  expect(csv.endsWith("\n")).toBe(true);
  expect(csv.endsWith("\n\n")).toBe(false);
});

test("passthrough columns survive import and export, in input order", () => {
  const { imported, exported } = throughSheet(
    "Period,USD,Label,Region,effective\n1980-01-21,850,gold,west,ignored\n2018-12,80000,,east,x\n",
  );
  expect(imported.extraColumns).toEqual(["Region"]);
  expect(imported.rows.filter((row) => !isBlank(row)).map((row) => row.extra)).toEqual([
    ["west"],
    ["east"],
  ]);
  const header = exported.csv.split("\n")[0];
  expect(header?.startsWith("date,amount,currency,label,Region,effective,")).toBe(true);
  expect(exported.csv.split("\n")[1]?.startsWith("1980-01-21,850,USD,gold,west,")).toBe(true);
});

test("bad lines are reported one by one and the good lines still load (FR16)", () => {
  const text = [
    "date,amount",
    "1980-01-21,850",
    "someday,5",
    "2018-12,not-a-number",
    "2999-01-01,10",
    "2018-12,80000",
  ].join("\n");
  const { imported } = throughSheet(text);
  expect(imported.loaded).toBe(2);
  expect(imported.errors.map((error) => error.line)).toEqual([3, 4, 5]);
  expect(imported.rows.filter((row) => !isBlank(row)).map((row) => row.date)).toEqual([
    "1980-01-21",
    "2018-12",
  ]);
  expect(imported.rows.at(-1)).toMatchObject({ amount: "", date: "" });
});

test("a file without date and amount columns is rejected as a whole", () => {
  expect(() => importSheet("foo,bar\n1,2\n", today)).toThrow(CsvFormatError);
  expect(() => importSheet("", today)).toThrow(CsvFormatError);
});

test("rows without a value are left out of the export and counted", () => {
  const rows: Row[] = [
    newRow({ amount: "1000", date: "1980-01-21" }),
    newRow({ amount: "5" }),
    newRow({ amount: "5", date: "2999" }),
    newRow(),
  ];
  const results = rows.map((row) => computeRow(row, table, today));
  const out = exportSheet(rows, results, []);
  expect(out.exported).toBe(1);
  expect(out.skipped).toBe(2);
  expect(out.csv.trimEnd().split("\n")).toHaveLength(2);
});

test("importSheet warns when a currency column differs from the sheet currency", () => {
  const imported = importSheet("date,amount,currency\n1980-01-21,1,GBP\n", today, "EUR");
  expect(imported.warnings).toEqual([
    "The file's currency column (GBP) differs from the sheet currency EUR; EUR is applied to every row.",
  ]);
  expect(importSheet("date,amount,currency\n1980-01-21,1,USD\n", today).warnings).toEqual([]);
});

test("EUR sheet export equals goldvalue.py --batch --currency EUR byte for byte", () => {
  const fx = FxRates.fromCsv({
    EUR: readVectorFile("snapshot", "fx_eur.csv"),
    GBP: readVectorFile("snapshot", "fx_gbp.csv"),
    CHF: readVectorFile("snapshot", "fx_chf.csv"),
  });
  const imported = importSheet(readVectorFile("batch-fx-eur-in.csv"), today, "EUR");
  expect(imported.errors).toEqual([]);
  expect(imported.warnings).toEqual([]);
  const results = imported.rows.map((row) => computeRow(row, table, today, "EUR", fx));
  expect(exportSheet(imported.rows, results, imported.extraColumns).csv).toBe(
    readVectorFile("batch-fx-eur-out.csv"),
  );
});

test("export appends gold_mode, ma_years, ma_months, and spot_usd_per_oz after fx_note", () => {
  const { imported, exported } = throughSheet("date,amount\n1980-01-21,850\n");
  expect(imported.extraColumns).toEqual([]);
  const [header, row] = exported.csv.trimEnd().split("\n");
  expect(header?.endsWith("fx_note,gold_mode,ma_years,ma_months,spot_usd_per_oz")).toBe(true);
  const columns = header?.split(",") ?? [];
  const fields = row?.split(",") ?? [];
  expect(fields[columns.indexOf("gold_mode")]).toBe("spot");
  expect(fields[columns.indexOf("ma_years")]).toBe("");
  expect(fields[columns.indexOf("ma_months")]).toBe("");
  expect(fields[columns.indexOf("spot_usd_per_oz")]).toBe(
    fields[columns.indexOf("gold_usd_per_oz")],
  );
});

test("import ignores gold_mode, ma_years, ma_months, and spot_usd_per_oz", () => {
  const imported = importSheet(
    "date,amount,gold_mode,ma_years,ma_months,spot_usd_per_oz\n1980-01-21,850,partial,99,1,1\n",
    today,
  );
  expect(imported.extraColumns).toEqual([]);
  expect(imported.errors).toEqual([]);
  expect(imported.rows.filter((row) => !isBlank(row)).map((row) => row.amount)).toEqual(["850"]);
});

test("rows typed by hand pad the passthrough columns of an imported sheet", () => {
  const imported = importSheet("date,amount,Region\n1980-01-21,850,west\n", today);
  const typed = newRow({ amount: "100", date: "2000" });
  const rows = [...imported.rows.slice(0, 1), typed];
  const results = rows.map((row) => computeRow(row, table, today));
  const lines = exportSheet(rows, results, imported.extraColumns).csv.split("\n");
  expect(lines[1]?.startsWith("1980-01-21,850,USD,,west,")).toBe(true);
  expect(lines[2]?.startsWith("2000,100,USD,,,")).toBe(true);
});
