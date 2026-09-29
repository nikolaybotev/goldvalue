import { describe, expect, test } from "vitest";
import {
  BIS_LAG_NOTE,
  CurrencyParseError,
  DEM_PER_EUR,
  EUR_PARITY_LABELS,
  type ForeignCurrency,
  FX_MODES,
  FxRates,
  FxTable,
  fxFileName,
  fxSourceOf,
  PARITY_TABLE,
  parseCurrency,
  parseDate,
  resolveFx,
  SYNTHETIC_EUR_NOTE,
} from "../src/index";
import { day } from "./support";

const SYNTHETIC_EUR =
  "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche " +
  "Mark at the fixed conversion rate 1 \u20ac = 1.95583 DM. Amounts originally in other " +
  "legacy currencies (francs, lire, \u2026) would differ.";

const tables: Record<"gbp" | "chf" | "eur", [string, string][]> = {
  gbp: [
    ["1953-08-10", "2.78"],
    ["1953-08-11", "2.79"],
    ["1980-01-18", "2.25"],
    ["1980-01-21", "2.26"],
    ["2026-09-21", "1.34"],
    ["2026-09-22", "1.35"],
  ],
  chf: [
    ["1953-09-01", "0.2333"],
    ["1980-01-21", "0.60"],
    ["1999-01-04", "0.7292"],
    ["2026-09-22", "1.25"],
  ],
  eur: [
    ["1953-09-01", "0.4656"],
    ["1980-01-21", "0.5"],
    ["1998-12-30", "1.10"],
    ["1998-12-31", "1.12"],
    ["1999-01-04", "1.17"],
    ["1999-01-05", "1.18"],
    ["2018-12-03", "1.13"],
    ["2018-12-04", "1.14"],
    ["2018-12-05", "1.15"],
    ["2026-09-21", "1.17"],
    ["2026-09-22", "1.18"],
  ],
};

const csv = (rows: [string, string][]) =>
  `date,usd_per_unit\n${rows.map(([d, v]) => `${d},${v}`).join("\n")}\n`;
const rates = FxRates.fromCsv({
  EUR: csv(tables.eur),
  GBP: csv(tables.gbp),
  CHF: csv(tables.chf),
});
const TODAY = "2026-09-29";

function resolve(currency: ForeignCurrency, date: string, today = TODAY) {
  return resolveFx(rates, currency, parseDate(date, day(today)), day(today));
}

describe("currency and table plumbing", () => {
  test("parseCurrency is case-insensitive and strict", () => {
    expect(parseCurrency(" eur ")).toBe("EUR");
    expect(parseCurrency("usd")).toBe("USD");
    expect(() => parseCurrency("JPY")).toThrow(CurrencyParseError);
  });

  test("DEM is served by the EUR file", () => {
    expect(fxSourceOf("DEM")).toBe("EUR");
    expect(fxSourceOf("USD")).toBeNull();
    expect(fxFileName("EUR")).toBe("fx_eur.csv");
  });

  test("FxTable parses CRLF files and rejects a missing column", () => {
    const table = FxTable.fromCsv("date,usd_per_unit\r\n2000-01-04,1.5\r\n2000-01-05,1.6\r\n");
    expect(table.first).toBe("2000-01-04");
    expect(table.last).toBe("2000-01-05");
    expect(table.value("2000-01-05")).toBe(1.6);
    expect(() => FxTable.fromCsv("date,usd\n2000-01-04,1\n")).toThrow();
    expect(() => FxTable.fromCsv("date,usd_per_unit\n")).toThrow();
  });

  test("missing tables are reported", () => {
    const partial = FxRates.fromCsv({ GBP: csv(tables.gbp) });
    expect(partial.has("GBP")).toBe(true);
    expect(partial.has("DEM")).toBe(false);
    expect(() => partial.tableFor("EUR")).toThrow("no FX data loaded for EUR");
  });
});

describe("parity table", () => {
  test.each([
    ["GBP", "1940-01-01", 4.03, "1940-01-01"],
    ["GBP", "1949-09-17", 4.03, "1940-01-01"],
    ["GBP", "1949-09-18", 2.8, "1949-09-18"],
    ["GBP", "1953-08-09", 2.8, "1949-09-18"],
    ["CHF", "1949-01-01", 1 / 4.37282, "1949-01-01"],
    ["CHF", "1953-08-31", 1 / 4.37282, "1949-01-01"],
    ["DEM", "1948-06-21", 1 / 3.33, "1948-06-21"],
    ["DEM", "1949-09-27", 1 / 3.33, "1948-06-21"],
    ["DEM", "1949-09-28", 1 / 4.2, "1949-09-28"],
    ["EUR", "1948-06-21", DEM_PER_EUR / 3.33, "1948-06-21"],
    ["EUR", "1949-09-28", DEM_PER_EUR / 4.2, "1949-09-28"],
    ["EUR", "1953-08-31", DEM_PER_EUR / 4.2, "1949-09-28"],
  ] as const)("%s %s", (currency, date, rate, effective) => {
    const got = resolve(currency, date);
    expect(got.rate).toBeCloseTo(rate, 12);
    expect(got.effective).toBe(effective);
    expect(got.mode).toBe("parity");
  });

  test.each([
    ["GBP", "1939-12-31", "1940-01-01"],
    ["GBP", "1900-01", "1940-01-01"],
    ["CHF", "1948-12-31", "1949-01-01"],
    ["DEM", "1948-06-20", "1948-06-21"],
    ["EUR", "1948-06-20", "1948-06-21"],
    ["DEM", "1900", "1948-06-21"],
  ] as const)("%s %s is extrapolated", (currency, date, effective) => {
    const got = resolve(currency, date);
    expect(got.mode).toBe("extrapolated");
    expect(got.effective).toBe(effective);
    expect(got.note.startsWith("Extrapolated: no parity table entry before")).toBe(true);
  });

  test("labels match their rates", () => {
    for (const [currency, rows] of Object.entries(PARITY_TABLE)) {
      for (const row of rows) {
        const digits = currency === "GBP" ? 2 : 4;
        expect(row.label).toContain(`$${row.rate.toFixed(digits)}`);
      }
    }
    for (const [start, label] of Object.entries(EUR_PARITY_LABELS)) {
      const dem = PARITY_TABLE.DEM.find((row) => row.date === start)?.rate as number;
      expect(label).toContain(`\u20ac1 = $${(dem * DEM_PER_EUR).toFixed(4)}`);
      expect(label).toContain(`DM 1 = $${dem.toFixed(4)}`);
    }
  });

  test("note text", () => {
    expect(resolve("GBP", "1950-06").note).toBe(
      "Bretton Woods parity \u00a31 = $2.80 (1949-09-18 to 1953-08-09).",
    );
    expect(resolve("GBP", "1945-01-01").note).toBe(
      "Bretton Woods parity \u00a31 = $4.03 (1940-01-01 to 1949-09-17).",
    );
    expect(resolve("CHF", "1950").note).toContain(
      "Bretton Woods parity CHF 1 = $0.2287 (4.37282 CHF per USD) (1949-01-01 to 1953-08-31)",
    );
    expect(resolve("GBP", "1900").note).toContain("$4.87");
  });

  test("months and years resolve at the midpoint", () => {
    expect(resolve("GBP", "1949-09").effective).toBe("1940-01-01");
    expect(resolve("GBP", "1949-10").rate).toBe(2.8);
    expect(resolve("GBP", "1949").rate).toBe(4.03);
    expect(resolve("GBP", "1950").rate).toBe(2.8);
  });
});

describe("daily resolution", () => {
  test("a clean observation has an empty note", () => {
    expect(resolve("GBP", "1980-01-21")).toEqual({
      rate: 2.26,
      effective: "1980-01-21",
      mode: "daily",
      note: "",
    });
  });

  test("weekend roll-back and the 9-day boundary", () => {
    const sun = resolve("GBP", "1980-01-20");
    expect([sun.rate, sun.effective, sun.mode]).toEqual([2.25, "1980-01-18", "daily"]);
    expect(sun.note).toBe(
      "no FX rate on 1980-01-20 (non-trading day); used previous rate from 1980-01-18",
    );
    expect(resolve("CHF", "1980-01-30").effective).toBe("1980-01-21");
    const far = resolve("CHF", "1980-01-31");
    expect(far.effective).toBe("1980-01-21");
    expect(far.note).toContain("no FX rate within 9 days");
  });

  test("after the latest rate the note says BIS lags", () => {
    expect(resolve("GBP", "2026-09-23").note).toBe(
      "no FX rate on 2026-09-23; used previous rate from 2026-09-22",
    );
    expect(resolve("GBP", "2026-09-29").note.endsWith(`(${BIS_LAG_NOTE})`)).toBe(true);
    expect(resolve("GBP", "2026-10-15", "2026-10-15").note).toBe(
      "requested date is after the latest available FX rate; used 2026-09-22 (BIS data lags about a week)",
    );
  });

  test("month is a mean of the observations", () => {
    const got = resolve("EUR", "2018-12");
    expect(got.rate).toBeCloseTo((1.13 + 1.14 + 1.15) / 3, 12);
    expect([got.effective, got.mode, got.note]).toEqual(["2018-12", "daily", ""]);
  });

  test("incomplete periods note the lag only when it exceeds 3 days", () => {
    expect(resolve("EUR", "2026-09").note).toBe(
      "period extends past the latest BIS observation (2026-09-22); " +
        "average of the 2 available daily rates (BIS data lags about a week)",
    );
    expect(resolve("EUR", "2026-09", "2026-09-24").note).toBe("");
    const after = resolve("GBP", "2026-11", "2026-11-20");
    expect([after.effective, after.rate]).toEqual(["2026-09-22", 1.35]);
    expect(after.note).toContain("after the latest available FX rate");
  });

  test("periods around the first observation", () => {
    const straddle = resolve("GBP", "1953-08");
    expect(straddle.rate).toBeCloseTo((2.78 + 2.79) / 2, 12);
    expect(straddle.mode).toBe("daily");
    expect(straddle.note).toContain("starts before the first BIS observation (1953-08-10)");
    expect(resolve("CHF", "1953-08").mode).toBe("parity");
    expect(resolve("CHF", "1953").mode).toBe("daily");
  });
});

describe("synthetic euro and precedence", () => {
  test("DEM is EUR divided by the conversion rate", () => {
    const eur = resolve("EUR", "1980-01-21");
    const dem = resolve("DEM", "1980-01-21");
    expect(dem.rate).toBe(0.5 / DEM_PER_EUR);
    expect([eur.mode, dem.mode]).toEqual(["synthetic", "daily"]);
    expect(eur.note).toBe(SYNTHETIC_EUR);
    expect(SYNTHETIC_EUR_NOTE).toBe(SYNTHETIC_EUR);
  });

  test("the boundary is decided by the observation dates used", () => {
    const mode = (c: ForeignCurrency, d: string) => resolve(c, d).mode;
    expect(mode("EUR", "1998-12-31")).toBe("synthetic");
    expect(mode("EUR", "1999-01-04")).toBe("daily");
    expect(mode("EUR", "1999-01-02")).toBe("synthetic");
    expect(mode("DEM", "1998-12-31")).toBe("daily");
    expect(mode("DEM", "1999-01-04")).toBe("synthetic");
    expect(resolve("DEM", "1999-01-04").note.startsWith("Synthetic Deutsche Mark")).toBe(true);
    expect(mode("EUR", "1999-01")).toBe("daily");
    expect(mode("EUR", "1998-12")).toBe("synthetic");
    expect(mode("DEM", "1998")).toBe("daily");
    expect(mode("DEM", "1999")).toBe("synthetic");
    expect(mode("GBP", "1980-01-21")).toBe("daily");
  });

  test("the highest mode wins and the note lists everything", () => {
    const parity = resolve("EUR", "1950-06");
    expect(parity.mode).toBe("parity");
    expect(parity.note.startsWith("Bretton Woods parity \u20ac1 = $0.4657")).toBe(true);
    expect(parity.note.endsWith(SYNTHETIC_EUR)).toBe(true);
    const ext = resolve("EUR", "1900-01");
    expect(ext.mode).toBe("extrapolated");
    expect(ext.note.startsWith("Extrapolated:")).toBe(true);
    expect(ext.note.endsWith(SYNTHETIC_EUR)).toBe(true);
    expect(resolve("DEM", "1950-06").mode).toBe("parity");
    expect(FX_MODES).toEqual(["daily", "synthetic", "parity", "extrapolated"]);
  });

  test("a rolled-back synthetic row lists both notes", () => {
    const got = resolve("EUR", "1999-01-02");
    expect(got.effective).toBe("1998-12-31");
    expect(got.note).toBe(
      `${SYNTHETIC_EUR} no FX rate on 1999-01-02 (non-trading day); used previous rate from 1998-12-31`,
    );
  });
});
