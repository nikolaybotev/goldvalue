import { CsvFormatError } from "@goldvalue/core";
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

test("rows typed by hand pad the passthrough columns of an imported sheet", () => {
  const imported = importSheet("date,amount,Region\n1980-01-21,850,west\n", today);
  const typed = newRow({ amount: "100", date: "2000" });
  const rows = [...imported.rows.slice(0, 1), typed];
  const results = rows.map((row) => computeRow(row, table, today));
  const lines = exportSheet(rows, results, imported.extraColumns).csv.split("\n");
  expect(lines[1]?.startsWith("1980-01-21,850,USD,,west,")).toBe(true);
  expect(lines[2]?.startsWith("2000,100,USD,,,")).toBe(true);
});
