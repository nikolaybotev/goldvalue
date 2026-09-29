import { type CivilDate, type Period, toDayNumber } from "@goldvalue/core";

/**
 * Chart/sort position of a requested period (spec FR12): the day itself, the 16th of
 * a month, 2 July of a year. Independent of the resolved `effective` date.
 */
export function midpoint(period: Period): CivilDate {
  const { anchor } = period;
  if (period.kind === "day") return anchor;
  if (period.kind === "month") return { year: anchor.year, month: anchor.month, day: 16 };
  return { year: anchor.year, month: 7, day: 2 };
}

export function midpointDayNumber(period: Period): number {
  return toDayNumber(midpoint(period));
}
