import { describe, expect, test } from "vitest";
import { type ConversionResult, convertQuery, parseIso } from "../src/index";
import { loadSnapshotTable, readJson } from "./support";

interface Vector {
  name: string;
  family: string;
  input: { amount: number; date: string; from: string; currency: string; today: string };
  expected: Omit<ConversionResult, "input" | "price_note" | "price_points">;
}

const vectors = readJson<Vector[]>("gold-usd.json");
const table = loadSnapshotTable();

function expectMatches(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const a = actual as number;
    const scale = Math.max(Math.abs(expected), Math.abs(a));
    expect(Math.abs(a - expected) <= 1e-9 * scale, `${path}: ${a} vs ${expected}`).toBe(true);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

describe("golden vectors (test-vectors/gold-usd.json)", () => {
  test("file is non-trivial and covers the spec families", () => {
    expect(vectors.length).toBeGreaterThan(90);
    const families = new Set(vectors.map((v) => v.family));
    for (const family of [
      "annual-pre1960",
      "monthly-pre1968",
      "am-only-1968",
      "london-closure-boundary",
      "weekend-holiday-rollback",
      "month-and-year-means",
      "to-date-pinned-year",
      "after-latest-fix",
      "units-from",
      "negative-and-edge-amounts",
    ]) {
      expect(families.has(family), family).toBe(true);
    }
  });

  test.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const result = convertQuery(table, {
      amount: vector.input.amount,
      date: vector.input.date,
      from: vector.input.from,
      today: parseIso(vector.input.today),
    });
    for (const [key, expected] of Object.entries(vector.expected)) {
      const actual = (result as unknown as Record<string, unknown>)[key];
      if (typeof expected === "number") {
        expectMatches(actual, expected, key);
      } else {
        expect(actual, key).toEqual(expected);
      }
    }
  });

  test("integer fields and text are exact", () => {
    for (const v of vectors) {
      const r = convertQuery(table, {
        amount: v.input.amount,
        date: v.input.date,
        from: v.input.from,
        today: parseIso(v.input.today),
      });
      expect(r.points, v.name).toBe(v.expected.points);
      expect(r.note, v.name).toBe(v.expected.note);
      expect(r.effective, v.name).toBe(v.expected.effective);
      expect(r.price_source, v.name).toBe(v.expected.price_source);
    }
  });
});
