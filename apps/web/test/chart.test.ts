import { expect, test } from "vitest";
import { chartHeight, computeLayout, nearestGroup, POINT_SPACING } from "../src/chart/layout";
import { buildPoints, groupByX, logAvailable } from "../src/chart/model";
import { computeRow } from "../src/store/compute";
import { newRow } from "../src/store/rows-logic";
import { day, fixtureTable } from "./support";

const table = fixtureTable();
const today = day("2026-09-29");

function pointsFor(entries: [string, string, string?][], unit: "GB" | "GBD" | "OZ" = "GB") {
  const rows = entries.map(([amount, date, label]) => newRow({ amount, date, label: label ?? "" }));
  const results = rows.map((row) => computeRow(row, table, today));
  return buildPoints(rows, results, unit);
}

test("smoothed rows keep the requested midpoint and carry a separate spot value", () => {
  const rows = [
    newRow({ amount: "1000", date: "2019" }),
    newRow({ amount: "1000", date: "2019-11-12" }),
  ];
  const results = rows.map((row) => computeRow(row, table, today, "USD", undefined, 10));
  const points = buildPoints(rows, results, "GB");
  const spotPoints = buildPoints(
    rows,
    rows.map((row) => computeRow(row, table, today)),
    "GB",
  );
  expect(points.map((p) => p.plotted)).toEqual(["2019-07-02", "2019-11-12"]);
  expect(points.every((p) => p.goldMode === "smoothed")).toBe(true);
  expect(points[0]?.spotValue).toBeCloseTo(spotPoints[0]?.value ?? Number.NaN);
  expect(points[1]?.spotValue).toBeCloseTo(spotPoints[1]?.value ?? Number.NaN);
  const groups = groupByX(points);
  const off = computeLayout({ width: 640, groups, unit: "GB", log: false, overlay: false });
  expect(off.spotPath).toBeNull();
  const on = computeLayout({
    width: 640,
    groups,
    unit: "GB",
    log: false,
    overlay: false,
    spotOverlay: true,
  });
  expect(on.linePath).toMatch(/^M/);
  expect(on.spotPath).toMatch(/^M/);
  const [lo, hi] = on.yScale.domain();
  const values = points.flatMap((p) => [p.value, p.spotValue]);
  expect(lo).toBeLessThanOrEqual(Math.min(...values));
  expect(hi).toBeGreaterThanOrEqual(Math.max(...values));
});

test("x is the middle of the requested period, not the resolved date (FR12)", () => {
  const points = pointsFor([
    ["1000", "1975"],
    ["1000", "1975-03"],
    ["1000", "1975-03-15"],
    ["1000", "2026-09-29"],
  ]);
  const byRequested = Object.fromEntries(points.map((p) => [p.requested, p.plotted]));
  expect(byRequested["1975"]).toBe("1975-07-02");
  expect(byRequested["1975-03"]).toBe("1975-03-16");
  expect(byRequested["1975-03-15"]).toBe("1975-03-15");
  expect(byRequested["2026-09-29"]).toBe("2026-09-29");
  const today = points.find((p) => p.requested === "2026-09-29");
  expect(today?.effective).toBe("2026-09-25");
});

test("points sort by chart position regardless of sheet order; invalid rows are skipped", () => {
  const points = pointsFor([
    ["1", "2003"],
    ["x", "2001"],
    ["1", "2001"],
    ["1", "2030"],
  ]);
  expect(points.map((p) => p.requested)).toEqual(["2001", "2003"]);
  expect(points.map((p) => p.rowNumber)).toEqual([3, 1]);
});

test("the tooltip states the granularity, e.g. year average of N fixes", () => {
  const points = pointsFor([
    ["1000", "1975"],
    ["1000", "1975-03"],
    ["1000", "1975-03-14"],
    ["1000", "1955"],
  ]);
  const at = (requested: string) => points.find((p) => p.requested === requested);
  const [year, month, day1, pre] = [at("1975"), at("1975-03"), at("1975-03-14"), at("1955")];
  expect(year?.granularity).toMatch(/^year average of \d+ fixes$/);
  expect(month?.granularity).toMatch(/^month average of \d+ fixes$/);
  expect(day1?.granularity).toBe("daily fix");
  expect(pre?.granularity).toBe("year average of 12 monthly values");
});

test("rows with the same x form one group and are drawn side by side", () => {
  const points = pointsFor([
    ["1000", "1975"],
    ["2000", "1975"],
    ["3000", "1990"],
  ]);
  const groups = groupByX(points);
  expect(groups.map((g) => g.points.length)).toEqual([2, 1]);
  const layout = computeLayout({ width: 640, groups, unit: "GB", log: false, overlay: false });
  const [a, b] = layout.groups[0]?.points ?? [];
  expect(b?.px).toBeCloseTo((a?.px ?? 0) + POINT_SPACING);
  expect(((a?.px ?? 0) + (b?.px ?? 0)) / 2).toBeCloseTo(layout.groups[0]?.cx ?? 0);
  expect(nearestGroup(layout, a?.px ?? 0, a?.py ?? 0)).toBe(layout.groups[0]);
  expect(nearestGroup(layout, -500, -500)).toBeNull();
});

test("negative values are plotted on a linear axis and the log toggle is withheld", () => {
  const points = pointsFor([
    ["-1000", "1990"],
    ["2000", "2000"],
  ]);
  expect(points[0]?.value).toBeLessThan(0);
  expect(logAvailable(points, false)).toBe(false);
  const layout = computeLayout({
    width: 640,
    groups: groupByX(points),
    unit: "GB",
    log: false,
    overlay: false,
  });
  expect(layout.zeroY).not.toBeNull();
  const [negative, positive] = layout.placed;
  expect((negative?.py ?? 0) > (positive?.py ?? 0)).toBe(true);
});

test("log scale is offered only when every plotted value (and the overlay) is positive", () => {
  const positive = pointsFor([
    ["1000", "1990"],
    ["2000", "2000"],
  ]);
  expect(logAvailable(positive, false)).toBe(true);
  expect(logAvailable(positive, true)).toBe(true);
  const zero = pointsFor([["0", "1990"]]);
  expect(logAvailable(zero, false)).toBe(false);
  expect(logAvailable([], false)).toBe(false);
  const layout = computeLayout({
    width: 640,
    groups: groupByX(positive),
    unit: "GB",
    log: true,
    overlay: true,
  });
  expect(layout.log).toBe(true);
  expect(layout.y2Scale).not.toBeNull();
  expect(layout.overlayPath).toMatch(/^M/);
});

test("axis unit switches the plotted value", () => {
  const gb = pointsFor([["1000", "1990-01-02"]], "GB")[0];
  const gbd = pointsFor([["1000", "1990-01-02"]], "GBD")[0];
  const oz = pointsFor([["1000", "1990-01-02"]], "OZ")[0];
  expect((gb?.value ?? 0) / (oz?.value ?? 1)).toBeCloseTo(1000);
  expect((gbd?.value ?? 0) / (oz?.value ?? 1)).toBeCloseTo(50);
});

test("a single point and identical x values still produce a finite layout", () => {
  const single = computeLayout({
    width: 320,
    groups: groupByX(pointsFor([["1000", "1990"]])),
    unit: "GB",
    log: false,
    overlay: false,
  });
  expect(single.linePath).toBe("");
  expect(Number.isFinite(single.placed[0]?.px ?? Number.NaN)).toBe(true);
  expect(Number.isFinite(single.placed[0]?.py ?? Number.NaN)).toBe(true);
  expect(chartHeight(320)).toBe(240);
  expect(chartHeight(2000)).toBe(420);
});
