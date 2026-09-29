import { expect, test } from "vitest";
import { dataVersionOf, shouldDiscardStored } from "../src/lib/data-version";

const manifest = (files: Record<string, string>) => ({
  files: Object.fromEntries(
    Object.entries(files).map(([name, sha256]) => [name, { rows: 1, last_date: "x", sha256 }]),
  ),
});

test("the data version is the sorted name:sha256 pairs and ignores other fields", () => {
  expect(dataVersionOf(manifest({ "monthly.csv": "aa", "fx_eur.csv": "bb" }))).toBe(
    "fx_eur.csv:bb|monthly.csv:aa",
  );
  expect(dataVersionOf({ files: { "monthly.csv": { sha256: "aa", rows: 5 } } })).toBe(
    "monthly.csv:aa",
  );
});

test("a manifest without hashes has no version", () => {
  for (const value of [null, undefined, 3, {}, { files: null }, { files: { a: {} } }]) {
    expect(dataVersionOf(value)).toBeNull();
  }
});

test("a changed data version discards the stored table when online", () => {
  expect(shouldDiscardStored("monthly.csv:aa", "monthly.csv:bb", true)).toBe(true);
});

test("an unchanged, unknown or unavailable version keeps the stored table", () => {
  expect(shouldDiscardStored("monthly.csv:aa", "monthly.csv:aa", true)).toBe(false);
  expect(shouldDiscardStored(undefined, "monthly.csv:bb", true)).toBe(false);
  expect(shouldDiscardStored(null, "monthly.csv:bb", true)).toBe(false);
  expect(shouldDiscardStored("monthly.csv:aa", null, true)).toBe(false);
});

test("nothing is discarded while offline", () => {
  expect(shouldDiscardStored("monthly.csv:aa", "monthly.csv:bb", false)).toBe(false);
});
