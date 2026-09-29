import { expect, test } from "vitest";
import { parsePasted, splitDelimited } from "../src/lib/paste";
import { day } from "./support";

const today = day("2026-09-29");

test("splitDelimited handles quotes, CRLF, and trailing newline", () => {
  expect(splitDelimited('a,"b,c",d\r\n"e ""q""",f\n', ",")).toEqual([
    ["a", "b,c", "d"],
    ['e "q"', "f"],
  ]);
});

test("single values are left to the browser", () => {
  expect(parsePasted("1,500", today)).toBeNull();
  expect(parsePasted("2018-12", today)).toBeNull();
  expect(parsePasted("hello", today)).toBeNull();
});

test("tab-separated spreadsheet cells become a positional grid", () => {
  expect(parsePasted("100\t2001\n200\t2002\n", today)).toEqual({
    kind: "grid",
    cells: [
      ["100", "2001"],
      ["200", "2002"],
    ],
  });
});

test("a header row maps columns by name, in any order", () => {
  expect(parsePasted('Date,Label,Amount\n2001,x,"1,500"\n', today)).toEqual({
    kind: "records",
    records: [{ date: "2001", label: "x", amount: "1,500" }],
  });
  expect(parsePasted("period\tvalue\n1999-01\t5", today)).toEqual({
    kind: "records",
    records: [{ date: "1999-01", amount: "5", label: "" }],
  });
});

test("headerless CSV with a date in the second field is amount,date", () => {
  expect(parsePasted("100,2001\n200,2002-05", today)).toEqual({
    kind: "grid",
    cells: [
      ["100", "2001"],
      ["200", "2002-05"],
    ],
  });
});

test("headerless CSV with the date first is recognised", () => {
  expect(parsePasted("2001-05-01,100\n2002-05-01,200", today)).toEqual({
    kind: "records",
    records: [
      { date: "2001-05-01", amount: "100", label: "" },
      { date: "2002-05-01", amount: "200", label: "" },
    ],
  });
});

test("a column of amounts with thousands separators is not split at the comma", () => {
  expect(parsePasted("1,500\n2,000\n3,250.50", today)).toEqual({
    kind: "grid",
    cells: [["1,500"], ["2,000"], ["3,250.50"]],
  });
});
