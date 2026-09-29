import { expect, test } from "vitest";
import {
  attemptAllowed,
  isDailyStale,
  londonToday,
  previousBusinessDay,
  REFRESH_INTERVAL_MS,
} from "../src/lib/clock";
import { formatUnit, sourceBadge, unitDigits } from "../src/lib/format";
import { midpoint } from "../src/lib/period";
import { day } from "./support";

test("previous London business day skips weekends", () => {
  expect(previousBusinessDay(day("2026-09-29"))).toEqual(day("2026-09-28"));
  expect(previousBusinessDay(day("2026-09-28"))).toEqual(day("2026-09-25"));
  expect(previousBusinessDay(day("2026-09-27"))).toEqual(day("2026-09-25"));
});

test("London date follows the London clock, not UTC", () => {
  expect(londonToday(new Date("2026-06-30T23:30:00Z"))).toEqual(day("2026-07-01"));
  expect(londonToday(new Date("2026-12-31T23:30:00Z"))).toEqual(day("2026-12-31"));
});

test("stale when the latest fix is older than the previous business day", () => {
  const tuesday = new Date("2026-09-29T12:00:00Z");
  expect(isDailyStale("2026-09-25", tuesday)).toBe(true);
  expect(isDailyStale("2026-09-28", tuesday)).toBe(false);
  expect(isDailyStale(null, tuesday)).toBe(true);
  const monday = new Date("2026-09-28T12:00:00Z");
  expect(isDailyStale("2026-09-25", monday)).toBe(false);
});

test("top-up attempts are limited to one per 12 hours", () => {
  expect(attemptAllowed(null, 1000)).toBe(true);
  expect(attemptAllowed(1000, 1000 + REFRESH_INTERVAL_MS - 1)).toBe(false);
  expect(attemptAllowed(1000, 1000 + REFRESH_INTERVAL_MS)).toBe(true);
  expect(attemptAllowed(5000, 1000)).toBe(true);
});

test("display precision follows the CLI", () => {
  expect(unitDigits(100)).toBe(2);
  expect(unitDigits(99.99)).toBe(4);
  expect(unitDigits(1)).toBe(4);
  expect(unitDigits(0.5)).toBe(6);
  expect(formatUnit(63979.5312)).toBe("63,979.53");
  expect(formatUnit(-2.5)).toBe("-2.5000");
  expect(formatUnit(-0)).toBe("0.000000");
  expect(sourceBadge("LBMA").short).toBe("LBMA");
});

test("chart position is the middle of the requested period (FR12)", () => {
  expect(midpoint({ kind: "day", anchor: day("2018-12-05") })).toEqual(day("2018-12-05"));
  expect(midpoint({ kind: "month", anchor: day("2018-12-01") })).toEqual(day("2018-12-16"));
  expect(midpoint({ kind: "year", anchor: day("1975-01-01") })).toEqual(day("1975-07-02"));
});
