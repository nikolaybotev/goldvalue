import {
  batchLayout,
  type CivilDate,
  CsvFormatError,
  parseAmount,
  parseDate,
} from "@goldvalue/core";

export interface PastedRecord {
  amount: string;
  date: string;
  label: string;
}

/**
 * Clipboard text as sheet data. `records` are named (a header row or an unambiguous
 * date-first layout mapped them); `grid` is positional, filled from the active cell.
 */
export type PastedTable =
  | { kind: "records"; records: PastedRecord[] }
  | { kind: "grid"; cells: string[][] };

/** RFC 4180-style split with quoted fields; a lone `\r` also ends a line. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      atFieldStart = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function dropTrailingBlankRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && (rows[end - 1] as string[]).every((cell) => cell.trim() === "")) end--;
  return rows.slice(0, end);
}

function isDate(text: string, today: CivilDate): boolean {
  try {
    parseDate(text, today);
    return true;
  } catch {
    return false;
  }
}

function isAmount(text: string): boolean {
  try {
    parseAmount(text);
    return true;
  } catch {
    return false;
  }
}

function headered(rows: string[][]): PastedTable | null {
  const [header, ...body] = rows;
  if (!header) return null;
  try {
    const layout = batchLayout(header);
    const at = (row: string[], index: number | null) =>
      index === null ? "" : (row[index] ?? "").trim();
    return {
      kind: "records",
      records: body.map((row) => ({
        amount: at(row, layout.amountIndex),
        date: at(row, layout.dateIndex),
        label: at(row, layout.labelIndex),
      })),
    };
  } catch (error) {
    if (error instanceof CsvFormatError) return null;
    throw error;
  }
}

/**
 * Interpret pasted text. Returns null for a single value (the caller lets the browser
 * paste it natively). Tab-separated text (spreadsheets) and comma-separated text (CSV)
 * are both accepted; a comma table is recognised only when a header names the date and
 * amount columns or every line's second field is a date, so a column of amounts such
 * as `1,500` is not split at its thousands separator.
 */
export function parsePasted(text: string, today: CivilDate): PastedTable | null {
  const tabbed = text.includes("\t");
  const delimiter = tabbed ? "\t" : ",";
  const rows = dropTrailingBlankRows(splitDelimited(text, delimiter));
  if (rows.length === 0) return null;

  const byHeader = headered(rows);
  if (byHeader) return byHeader;

  if (!tabbed) {
    const usable = rows.every((row) => row.length >= 2 && isDate((row[1] as string).trim(), today));
    const dateFirst =
      !usable &&
      rows.every(
        (row) =>
          row.length >= 2 &&
          isDate((row[0] as string).trim(), today) &&
          isAmount((row[1] as string).trim()),
      );
    if (dateFirst) {
      return {
        kind: "records",
        records: rows.map((row) => ({
          date: (row[0] as string).trim(),
          amount: (row[1] as string).trim(),
          label: (row[2] ?? "").trim(),
        })),
      };
    }
    if (!usable) {
      const lines = text.split(/\r\n|\r|\n/);
      while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === "") lines.pop();
      if (lines.length <= 1) return null;
      return { kind: "grid", cells: lines.map((line) => [line.trim()]) };
    }
  }

  if (rows.length === 1 && rows[0]?.length === 1) return null;
  return { kind: "grid", cells: rows.map((row) => row.map((cell) => cell.trim())) };
}
