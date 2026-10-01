import { describe, expect, test } from "vitest";
import { type ConversionResult, convertQuery, parseIso } from "../src/index";
import { loadSnapshotFx, loadSnapshotTable, readJson } from "./support";

interface Vector {
  name: string;
  family: string;
  input: {
    amount: number;
    date: string;
    from: string;
    currency: string;
    today: string;
    smooth?: string;
  };
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
      "smoothed",
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
      smooth: vector.input.smooth,
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
        smooth: v.input.smooth,
      });
      expect(r.points, v.name).toBe(v.expected.points);
      expect(r.note, v.name).toBe(v.expected.note);
      expect(r.effective, v.name).toBe(v.expected.effective);
      expect(r.price_source, v.name).toBe(v.expected.price_source);
    }
  });
});

const fx = loadSnapshotFx();
const fxVectors = readJson<Vector[]>("fx.json");

describe("FX golden vectors (test-vectors/fx.json, AC12)", () => {
  const run = (v: Vector) =>
    convertQuery(table, {
      amount: v.input.amount,
      date: v.input.date,
      from: v.input.from,
      currency: v.input.currency,
      fx,
      today: parseIso(v.input.today),
    });

  test("file covers the FX families and every currency", () => {
    expect(fxVectors.length).toBeGreaterThan(100);
    const families = new Set(fxVectors.map((v) => v.family));
    for (const family of [
      "fx-parity-steps",
      "fx-first-observation",
      "fx-euro-boundary",
      "fx-euro-pre1953",
      "fx-euro-synthetic",
      "fx-extrapolated",
      "fx-daily",
      "fx-rollback",
      "fx-latest",
    ]) {
      expect(families.has(family), family).toBe(true);
    }
    expect(new Set(fxVectors.map((v) => v.input.currency))).toEqual(
      new Set(["EUR", "GBP", "CHF", "DEM"]),
    );
    expect(new Set(fxVectors.map((v) => v.expected.fx_mode))).toEqual(
      new Set(["daily", "synthetic", "parity", "extrapolated"]),
    );
  });

  test.each(fxVectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const result = run(vector) as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(vector.expected)) {
      if (typeof expected === "number") expectMatches(result[key], expected, key);
      else expect(result[key], key).toEqual(expected);
    }
  });

  test("text and integer fields are exact for every vector", () => {
    for (const v of fxVectors) {
      const r = run(v);
      expect(r.fx_note, v.name).toBe(v.expected.fx_note);
      expect(r.fx_mode, v.name).toBe(v.expected.fx_mode);
      expect(r.fx_effective, v.name).toBe(v.expected.fx_effective);
      expect(r.note, v.name).toBe(v.expected.note);
      expect(r.effective, v.name).toBe(v.expected.effective);
      expect(r.points, v.name).toBe(v.expected.points);
    }
  });

  test("the D10 synthetic-euro text is verbatim", () => {
    const v = fxVectors.find((x) => x.name === "EUR 1985-06 month (AC10 synthetic)");
    expect(run(v as Vector).fx_note).toBe(
      "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche " +
        "Mark at the fixed conversion rate 1 \u20ac = 1.95583 DM. Amounts originally in other " +
        "legacy currencies (francs, lire, \u2026) would differ.",
    );
  });
});
