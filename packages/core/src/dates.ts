/**
 * Calendar dates and the FR2 date grammar.
 *
 * `parseDate` reproduces `parse_period` in goldvalue.py, which is built on Python's
 * `strptime`. To stay byte-compatible it rebuilds the same regular expressions,
 * including the lenient parts (unpadded numbers, case-insensitive month names,
 * repeated whitespace) and the "match a prefix, then reject leftovers" rule.
 * Dates are plain year/month/day triples, never `Date` objects: `Date` remaps years
 * below 100 and depends on the time zone.
 */

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export type PeriodKind = "day" | "month" | "year";

export interface Period {
  kind: PeriodKind;
  anchor: CivilDate;
}

export class DateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateParseError";
  }
}

export class FutureDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FutureDateError";
  }
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

/** Characters Python's `str.strip()` and the regex `\s` remove from ASCII input. */
const ASCII_WS = " \\t\\n\\v\\f\\r\\x1c-\\x1f";
/** Everything Python's `str.isspace()` accepts (used by `pyStrip`). */
const PY_WS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");

/** Python `str.strip()` (JavaScript's `trim` differs on U+FEFF and U+001C-U+001F). */
export function pyStrip(text: string): string {
  return text.replace(PY_STRIP, "");
}

export function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatIso(date: CivilDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function formatMonth(year: number, month: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}`;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function parseIso(text: string): CivilDate {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  const date = match && {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (!date || !isValidDate(date.year, date.month, date.day)) {
    throw new DateParseError(`invalid ISO date ${JSON.stringify(text)}`);
  }
  return date;
}

/** Days since 1970-01-01 (proleptic Gregorian), valid for years 1 to 9999. */
export function toDayNumber(date: CivilDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (date.month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** 0 = Monday ... 6 = Sunday, like Python's `date.weekday()`. */
export function weekday(date: CivilDate): number {
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function sameDate(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

interface Directive {
  pattern: string;
}

const DIRECTIVES: Record<string, Directive> = {
  Y: { pattern: "(?<Y>[0-9]{4})" },
  m: { pattern: "(?<m>1[0-2]|0[1-9]|[1-9])" },
  d: { pattern: "(?<d>3[0-1]|[1-2][0-9]|0[1-9]|[1-9]| [1-9])" },
  B: { pattern: `(?<B>${[...MONTH_NAMES].sort((a, b) => b.length - a.length).join("|")})` },
  b: { pattern: `(?<b>${MONTH_ABBREVIATIONS.join("|")})` },
};

function compileFormat(format: string): RegExp {
  let source = "";
  let pendingSpace = false;
  for (let i = 0; i < format.length; i++) {
    const ch = format.charAt(i);
    if (ch === " ") {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      source += `[${ASCII_WS}]+`;
      pendingSpace = false;
    }
    if (ch === "%") {
      const directive = DIRECTIVES[format.charAt(++i)];
      if (!directive) throw new Error(`unsupported directive in ${format}`);
      source += directive.pattern;
    } else {
      source += ch.replace(/[\\.^$*+?(){}[\]|]/g, "\\$&");
    }
  }
  if (pendingSpace) source += `[${ASCII_WS}]+`;
  return new RegExp(`^${source}`, "i");
}

const DAY_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%d %B %Y", "%B %d, %Y", "%b %d, %Y", "%d %b %Y"].map(
  compileFormat,
);
const MONTH_FORMATS = ["%Y-%m", "%m/%Y", "%B %Y", "%b %Y", "%Y/%m"].map(compileFormat);

/** Equivalent of `datetime.strptime(text, format).date()`; undefined where Python raises. */
function strptime(regex: RegExp, text: string): CivilDate | undefined {
  const match = regex.exec(text);
  if (!match || match[0].length !== text.length) return undefined;
  const groups = match.groups ?? {};
  const year = Number(groups.Y);
  let month = groups.m !== undefined ? Number(groups.m) : 0;
  if (groups.B !== undefined) month = MONTH_NAMES.indexOf(groups.B.toLowerCase()) + 1;
  if (groups.b !== undefined) month = MONTH_ABBREVIATIONS.indexOf(groups.b.toLowerCase()) + 1;
  const day = groups.d !== undefined ? Number(groups.d.trim()) : 1;
  return isValidDate(year, month, day) ? { year, month, day } : undefined;
}

const KEYWORDS = new Set(["today", "now", "latest"]);

export function parseDate(text: string, today: CivilDate): Period {
  const s = pyStrip(text);
  if (!isAscii(s)) {
    throw new DateParseError(`unrecognised date ${JSON.stringify(text)}; ASCII only`);
  }
  if (KEYWORDS.has(s.toLowerCase())) return { kind: "day", anchor: today };
  for (const regex of DAY_FORMATS) {
    const anchor = strptime(regex, s);
    if (anchor) return { kind: "day", anchor };
  }
  for (const regex of MONTH_FORMATS) {
    const anchor = strptime(regex, s);
    if (anchor) return { kind: "month", anchor };
  }
  if (/^[0-9]{4}$/.test(s) && Number(s) >= 1) {
    return { kind: "year", anchor: { year: Number(s), month: 1, day: 1 } };
  }
  throw new DateParseError(
    `unrecognised date ${JSON.stringify(text)}; use YYYY, YYYY-MM, YYYY-MM-DD, 'Mar 1975', 'today'`,
  );
}

/** A period whose first day is after `today` is an error (spec FR2a). */
export function checkNotFuture(anchor: CivilDate, token: string, today: CivilDate): void {
  if (compareDates(anchor, today) > 0) {
    throw new FutureDateError(`${JSON.stringify(token)}: date is in the future`);
  }
}
