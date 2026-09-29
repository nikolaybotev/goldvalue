import { expect, test } from "vitest";
import {
  applyPaste,
  hasEntry,
  isBlank,
  moveRow,
  moveRowTo,
  newRow,
  normalize,
  removeRow,
  setField,
  sortByDate,
} from "../src/store/rows-logic";
import { day } from "./support";

const texts = (rows: ReturnType<typeof normalize>) => rows.map((r) => `${r.amount}|${r.date}`);

test("normalize keeps exactly one empty row at the end (FR4)", () => {
  expect(texts(normalize([]))).toEqual(["|"]);
  expect(texts(normalize([newRow({ amount: "5" })]))).toEqual(["5|", "|"]);
  expect(texts(normalize([newRow({ date: "2020" })]))).toEqual(["|2020", "|"]);
  expect(texts(normalize([newRow({ amount: "5" }), newRow(), newRow()]))).toEqual(["5|", "|"]);
  expect(texts(normalize([newRow({ label: "note" })]))).toEqual(["|"]);
});

test("normalize without trim leaves surplus empty rows alone", () => {
  const rows = [newRow({ amount: "5" }), newRow(), newRow()];
  expect(normalize(rows, false)).toHaveLength(3);
});

test("blank and entry predicates", () => {
  expect(isBlank(newRow({ amount: " " }))).toBe(true);
  expect(isBlank(newRow({ label: "x" }))).toBe(false);
  expect(hasEntry(newRow({ label: "x" }))).toBe(false);
  expect(hasEntry(newRow({ date: "1999" }))).toBe(true);
});

test("move, delete, and drag reorder", () => {
  const rows = ["a", "b", "c"].map((amount) => newRow({ amount }));
  expect(moveRow(rows, 0, 1).map((r) => r.amount)).toEqual(["b", "a", "c"]);
  expect(moveRow(rows, 0, -1).map((r) => r.amount)).toEqual(["a", "b", "c"]);
  expect(moveRow(rows, 2, 1).map((r) => r.amount)).toEqual(["a", "b", "c"]);
  expect(moveRowTo(rows, 0, 2).map((r) => r.amount)).toEqual(["b", "c", "a"]);
  expect(removeRow(rows, 1).map((r) => r.amount)).toEqual(["a", "c"]);
  expect(setField(rows, rows[1]?.id as string, "date", "1999")[1]?.date).toBe("1999");
});

test("sort by date uses the chart position and keeps empty and invalid rows last", () => {
  const rows = [
    newRow({ amount: "1", date: "1975" }),
    newRow({ amount: "2", date: "1975-03" }),
    newRow({ amount: "3", date: "bogus" }),
    newRow({ amount: "4", date: "1975-07-03" }),
    newRow({ amount: "5", date: "1975-07-01" }),
    newRow(),
  ];
  const asc = sortByDate(rows, day("2026-09-29"), "asc").map((r) => r.amount);
  expect(asc).toEqual(["2", "5", "1", "4", "3", ""]);
  const desc = sortByDate(rows, day("2026-09-29"), "desc").map((r) => r.amount);
  expect(desc).toEqual(["4", "1", "5", "2", "3", ""]);
});

test("paste fills positionally from the start cell and grows the sheet", () => {
  const rows = [newRow(), newRow()];
  const out = applyPaste(rows, 1, "amount", {
    kind: "grid",
    cells: [
      ["100", "2001"],
      ["200", "2002", "second"],
    ],
  });
  expect(out.map((r) => [r.amount, r.date, r.label])).toEqual([
    ["", "", ""],
    ["100", "2001", ""],
    ["200", "2002", "second"],
  ]);
  const shifted = applyPaste([newRow()], 0, "date", { kind: "grid", cells: [["2001", "note"]] });
  expect(shifted[0]).toMatchObject({ amount: "", date: "2001", label: "note" });
});

test("paste of named records ignores the start column", () => {
  const out = applyPaste([newRow()], 0, "label", {
    kind: "records",
    records: [{ amount: "7", date: "1999", label: "" }],
  });
  expect(out[0]).toMatchObject({ amount: "7", date: "1999" });
});
