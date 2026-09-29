import Papa from "papaparse";
import { parseAmount } from "./amounts";
import { type ConversionResult, convert } from "./convert";
import { type CivilDate, checkNotFuture, type Period, parseDate } from "./dates";
import type { GoldTable } from "./table";
import { PriceNotFoundError } from "./table";
import type { Unit } from "./units";

/** Fixed leading export columns (spec FR15). */
export const FIXED_COLUMNS = ["date", "amount", "currency", "label"] as const;

/** Computed export columns (spec FR15); ignored when found in an import. */
export const COMPUTED_COLUMNS = [
  "effective",
  "gold_usd_per_oz",
  "troy_oz",
  "GB",
  "GBD",
  "USD",
  "price_source",
  "granularity",
  "note",
  "fx_rate",
  "fx_effective",
  "fx_mode",
  "fx_note",
] as const;

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export interface PassthroughColumn {
  name: string;
  index: number;
}

export interface BatchLayout {
  dateIndex: number;
  amountIndex: number;
  labelIndex: number | null;
  passthrough: PassthroughColumn[];
}

const DATE_NAMES = ["date", "period", "month", "year"];
const AMOUNT_NAMES = ["amount", "usd", "value", "price"];

const lower = (name: string) => name.trim().toLowerCase();

/**
 * Port of `batch_layout` (spec FR14 and the Phase 2 "dedupe rule").
 *
 * - Header names compare trimmed and case-insensitively; when a name repeats, the
 *   first column wins and later ones are dropped.
 * - Computed export columns and `currency` are ignored when picking the date and
 *   amount columns and never pass through. `USD` also serves as a legacy amount
 *   alias, so it counts as computed only when the header has `troy_oz` or
 *   `gold_usd_per_oz` (an exported file).
 * - Passthrough columns named like any output column are dropped, so an export
 *   never repeats a header name.
 */
export function batchLayout(header: readonly string[]): BatchLayout {
  const first = new Map<string, number>();
  header.forEach((name, index) => {
    if (!first.has(lower(name))) first.set(lower(name), index);
  });
  const computed = new Set(COMPUTED_COLUMNS.map(lower));
  const exported = first.has("troy_oz") || first.has("gold_usd_per_oz");
  const ignored = new Set(computed);
  if (!exported) ignored.delete("usd");
  ignored.add("currency");
  const reserved = new Set([...computed, ...FIXED_COLUMNS]);

  const pick = (names: string[]): number | undefined => {
    for (const name of names) {
      const index = first.get(name);
      if (index !== undefined && !ignored.has(name)) return index;
    }
    return undefined;
  };
  const dateIndex = pick(DATE_NAMES);
  const amountIndex = pick(AMOUNT_NAMES);
  if (dateIndex === undefined || amountIndex === undefined) {
    throw new CsvFormatError("CSV needs a 'date' column and an 'amount' column");
  }
  const labelIndex = first.get("label") ?? null;
  const used = new Set<number | null>([dateIndex, amountIndex, labelIndex]);
  const passthrough: PassthroughColumn[] = [];
  for (const [key, index] of first) {
    if (!used.has(index) && !reserved.has(key)) {
      passthrough.push({ name: header[index] as string, index });
    }
  }
  passthrough.sort((a, b) => a.index - b.index);
  return { dateIndex, amountIndex, labelIndex, passthrough };
}

/** A validated input row. `date` and `amount` keep the user's text. */
export interface ImportedRow {
  line: number;
  date: string;
  amount: string;
  label: string;
  /** Values of the passthrough columns, aligned with `ImportResult.columns`. */
  extra: string[];
  period: Period;
  value: number;
}

export interface ImportError {
  line: number;
  message: string;
}

export interface ImportResult {
  /** Passthrough column names, in input order. */
  columns: string[];
  rows: ImportedRow[];
  errors: ImportError[];
}

const field = (row: readonly string[], index: number | null): string =>
  index === null ? "" : (row[index] ?? "");

interface CsvRecord {
  line: number;
  fields: string[];
}

/** Parse CSV text into records with the physical line each one ends on (like `csv.reader`). */
function readRecords(text: string): CsvRecord[] {
  const clean = text.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  const terminator = /\r\n|\r|\n/g;
  let counted = 0;
  let countedTo = 0;
  let endsWithTerminator = false;
  Papa.parse<string[]>(clean, {
    delimiter: ",",
    skipEmptyLines: true,
    step: (results) => {
      const cursor = results.meta.cursor;
      terminator.lastIndex = countedTo;
      let match = terminator.exec(clean);
      while (match !== null && match.index + match[0].length <= cursor) {
        counted++;
        countedTo = match.index + match[0].length;
        match = terminator.exec(clean);
      }
      endsWithTerminator = countedTo === cursor;
      records.push({ line: endsWithTerminator ? counted : counted + 1, fields: results.data });
    },
  });
  return records;
}

/**
 * Import a CSV per spec FR14/FR16: bad lines are reported and the rest still load.
 * Throws CsvFormatError when the file is empty or lacks a date or amount column.
 */
export function importCsv(text: string, today: CivilDate): ImportResult {
  const [headerRecord, ...records] = readRecords(text);
  if (!headerRecord) throw new CsvFormatError("CSV is empty");
  const layout = batchLayout(headerRecord.fields);
  const rows: ImportedRow[] = [];
  const errors: ImportError[] = [];
  for (const { line, fields } of records) {
    const date = field(fields, layout.dateIndex);
    const amount = field(fields, layout.amountIndex);
    try {
      const period = parseDate(date, today);
      checkNotFuture(period.anchor, date, today);
      const value = parseAmount(amount);
      rows.push({
        line,
        date,
        amount,
        label: field(fields, layout.labelIndex),
        extra: layout.passthrough.map((column) => field(fields, column.index)),
        period,
        value,
      });
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { columns: layout.passthrough.map((column) => column.name), rows, errors };
}

/**
 * Fixed-point text like Python's `f"{x:.{digits}f}"`: exact decimal expansion with
 * ties rounded to even, no exponent form. (`toFixed` rounds exact ties up.)
 */
export function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) throw new RangeError("cannot format a non-finite number");
  const negative = value < 0;
  const abs = Math.abs(value);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, abs);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponentBits === 0 ? fraction : fraction | (1n << 52n);
  const exponent = (exponentBits === 0 ? 1 : exponentBits) - 1075;
  const scaled = mantissa * 10n ** BigInt(digits);
  let integer: bigint;
  if (exponent >= 0) {
    integer = scaled << BigInt(exponent);
  } else {
    const divisor = 1n << BigInt(-exponent);
    integer = scaled / divisor;
    const twiceRemainder = (scaled % divisor) * 2n;
    if (twiceRemainder > divisor || (twiceRemainder === divisor && (integer & 1n) === 1n)) {
      integer += 1n;
    }
  }
  let text = integer.toString().padStart(digits + 1, "0");
  if (digits > 0) text = `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative ? `-${text}` : text;
}

/** CSV quoting like Python's `csv.writer` (QUOTE_MINIMAL, `\n` terminator). */
export function quoteField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export interface ExportRow {
  date: string;
  amount: string;
  currency: string;
  label: string;
  extra: string[];
  result: ConversionResult;
}

/** Text for a value in an fx_* column (empty when the row has no FX). */
const optionalText = (value: string | number | null): string =>
  value === null ? "" : String(value);

/** Build the FR15 CSV: fixed columns, passthrough columns, computed columns; LF endings. */
export function exportCsv(extraColumns: readonly string[], rows: readonly ExportRow[]): string {
  const lines = [[...FIXED_COLUMNS, ...extraColumns, ...COMPUTED_COLUMNS]];
  for (const row of rows) {
    const r = row.result;
    lines.push([
      row.date,
      row.amount,
      row.currency,
      row.label,
      ...row.extra,
      r.effective,
      formatFixed(r.gold_usd_per_oz, 4),
      formatFixed(r.troy_oz, 6),
      formatFixed(r.GB, 3),
      formatFixed(r.GBD, 4),
      formatFixed(r.USD, 2),
      r.price_source,
      r.granularity,
      r.note,
      optionalText(r.fx_rate),
      optionalText(r.fx_effective),
      optionalText(r.fx_mode),
      optionalText(r.fx_note),
    ]);
  }
  const text = lines.map((line) => line.map(quoteField).join(",")).join("\n");
  return `${text}\n`;
}

export interface BatchOptions {
  today: CivilDate;
  /** Unit of the amounts (`--from`); written to the `currency` column. Default USD. */
  unit?: Unit;
}

export interface BatchResult {
  csv: string;
  /** Lines that could not be parsed (the CLI aborts on the first; the app reports all). */
  errors: ImportError[];
  /** Lines skipped because no price data exists for the period. */
  skipped: ImportError[];
}

/** The CLI's `--batch` pipeline in TypeScript: import, convert every row, export. */
export function runBatch(text: string, table: GoldTable, options: BatchOptions): BatchResult {
  const unit = options.unit ?? "USD";
  const imported = importCsv(text, options.today);
  const skipped: ImportError[] = [];
  const out: ExportRow[] = [];
  for (const row of imported.rows) {
    try {
      const result = convert(table, row.value, unit, row.period, options.today);
      out.push({
        date: row.date,
        amount: row.amount,
        currency: unit,
        label: row.label,
        extra: row.extra,
        result,
      });
    } catch (error) {
      if (!(error instanceof PriceNotFoundError)) throw error;
      skipped.push({ line: row.line, message: error.message });
    }
  }
  return { csv: exportCsv(imported.columns, out), errors: imported.errors, skipped };
}
