import { addDays, type CivilDate, formatIso, weekday } from "@goldvalue/core";

/** The browser's local calendar date (what `today` means in the sheet). */
export function localToday(now: Date = new Date()): CivilDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The calendar date in London at `now` (LBMA publishes on London business days). */
export function londonToday(now: Date = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Latest Monday to Friday strictly before `date` (bank holidays are not modelled). */
export function previousBusinessDay(date: CivilDate): CivilDate {
  let day = addDays(date, -1);
  while (weekday(day) >= 5) day = addDays(day, -1);
  return day;
}

/**
 * Spec 6.3.2: the cached table is stale when its latest fix is older than the previous
 * London business day. A missing table is always stale.
 */
export function isDailyStale(lastFix: string | null, now: Date = new Date()): boolean {
  if (lastFix === null) return true;
  return lastFix < formatIso(previousBusinessDay(londonToday(now)));
}

export const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** The 12-hour top-up rate limit (spec 6.3.2). */
export function attemptAllowed(lastAttempt: number | null, nowMs: number): boolean {
  return lastAttempt === null || nowMs - lastAttempt >= REFRESH_INTERVAL_MS || nowMs < lastAttempt;
}
