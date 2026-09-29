import { describe, expect, test } from "vitest";
import {
  type FetchLike,
  fetchLbmaSince,
  GoldTable,
  LBMA_AM_URL,
  LBMA_PM_URL,
  LbmaFormatError,
  lbmaToDaily,
  mergeLbma,
  parseIso,
  parseLbmaJson,
} from "../src/index";
import { readJson, readVectorFile } from "./support";

const pmJson = readJson<unknown>("snapshot/gold_pm.json");
const amJson = readJson<unknown>("snapshot/gold_am.json");

function stubFetch(calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    if (url === LBMA_PM_URL) return { ok: true, status: 200, json: async () => pmJson };
    if (url === LBMA_AM_URL) return { ok: true, status: 200, json: async () => amJson };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe("parseLbmaJson", () => {
  test("keeps USD only, tolerates extra keys and null entries", () => {
    const parsed = parseLbmaJson([
      { is_cms_locked: 0, d: "1968-04-01", v: [37.7, 15.68, null] },
      { d: "1999-01-04", v: [null, 1, 2] },
      { d: "1999-01-05", v: [285.5, 1, 2] },
    ]);
    expect([...parsed]).toEqual([
      ["1968-04-01", 37.7],
      ["1999-01-05", 285.5],
    ]);
  });

  test("rejects malformed payloads", () => {
    expect(() => parseLbmaJson({})).toThrow(LbmaFormatError);
    expect(() => parseLbmaJson([null])).toThrow(LbmaFormatError);
    expect(() => parseLbmaJson([{ d: 5, v: [1] }])).toThrow(LbmaFormatError);
    expect(() => parseLbmaJson([{ d: "2000-01-04", v: "x" }])).toThrow(LbmaFormatError);
    expect(() => parseLbmaJson([{ d: "2000-01-04", v: ["1"] }])).toThrow(LbmaFormatError);
    expect(() => parseLbmaJson([{ d: "2000-1-4", v: [1] }])).toThrow();
  });
});

describe("fetchLbmaSince (fetch injected; no network)", () => {
  test("merged rows equal the fixture's lbma_daily.csv", async () => {
    const calls: string[] = [];
    const rows = await fetchLbmaSince(stubFetch(calls));
    expect(calls.sort()).toEqual([LBMA_AM_URL, LBMA_PM_URL].sort());
    const csv = readVectorFile("snapshot/lbma_daily.csv").trim().split("\n").slice(1);
    expect(rows).toHaveLength(csv.length);
    csv.forEach((line, i) => {
      const [date, am, pm] = line.split(",");
      expect(rows[i]).toEqual({ date, am: am ? Number(am) : null, pm: pm ? Number(pm) : null });
    });
  });

  test("daily entries feed a GoldTable identical to the CSV-built one", async () => {
    const fromJson = new GoldTable(lbmaToDaily(await fetchLbmaSince(stubFetch())), []);
    const fromCsv = GoldTable.fromCsv(readVectorFile("snapshot/lbma_daily.csv"), "month,usd\n");
    expect(fromJson.dailyDates).toEqual(fromCsv.dailyDates);
    for (const date of ["1968-01-02", "1990-06-13", "2002-09-11", "2026-09-25"]) {
      expect(fromJson.dailyValue(date)).toBe(fromCsv.dailyValue(date));
    }
  });

  test("since trims older rows", async () => {
    const rows = await fetchLbmaSince(stubFetch(), "2026-09-24");
    expect(rows.map((r) => r.date)).toEqual(["2026-09-24", "2026-09-25"]);
    expect(parseIso(rows[0]?.date ?? "").year).toBe(2026);
  });

  test("HTTP errors surface", async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchLbmaSince(failing)).rejects.toThrow("HTTP 503");
  });

  test("AM-only and PM-only days are preserved by mergeLbma", () => {
    const rows = mergeLbma(
      new Map([["2000-01-05", 2]]),
      new Map([
        ["2000-01-04", 1],
        ["2000-01-05", 3],
      ]),
    );
    expect(rows).toEqual([
      { date: "2000-01-04", am: 1, pm: null },
      { date: "2000-01-05", am: 3, pm: 2 },
    ]);
    expect(lbmaToDaily(rows)).toEqual([
      ["2000-01-04", 1],
      ["2000-01-05", 2],
    ]);
  });
});
