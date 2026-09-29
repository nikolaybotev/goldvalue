import { type CivilDate, parseDate } from "@goldvalue/core";
import type { PastedTable } from "../lib/paste";
import { midpointDayNumber } from "../lib/period";

export type Field = "amount" | "date" | "label";
export const EDITABLE_FIELDS: readonly Field[] = ["amount", "date", "label"];

export interface Row {
  id: string;
  amount: string;
  date: string;
  label: string;
}

let sequence = 0;

export function newRow(init: Partial<Omit<Row, "id">> = {}): Row {
  sequence += 1;
  return { id: `r${sequence}`, amount: "", date: "", label: "", ...init };
}

const blank = (text: string) => text.trim() === "";

export function isBlank(row: Row): boolean {
  return blank(row.amount) && blank(row.date) && blank(row.label);
}

/** FR4: a row that carries an amount or a date makes the sheet grow. */
export function hasEntry(row: Row): boolean {
  return !blank(row.amount) || !blank(row.date);
}

/**
 * Keep the sheet editable: exactly one empty row at the end (FR4). `trim` also drops
 * surplus empty rows at the end; it is skipped while a cell is being edited so the
 * row under the caret does not vanish.
 */
export function normalize(rows: readonly Row[], trim = true): Row[] {
  const out = rows.slice();
  if (trim) {
    while (
      out.length >= 2 &&
      isBlank(out[out.length - 1] as Row) &&
      isBlank(out[out.length - 2] as Row)
    ) {
      out.pop();
    }
  }
  const last = out[out.length - 1];
  if (last === undefined || hasEntry(last)) out.push(newRow());
  return out;
}

export function setField(rows: readonly Row[], id: string, field: Field, value: string): Row[] {
  return rows.map((row) => (row.id === id ? { ...row, [field]: value } : row));
}

export function moveRow(rows: readonly Row[], index: number, delta: -1 | 1): Row[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
    return rows.slice();
  }
  const out = rows.slice();
  const [moved] = out.splice(index, 1);
  out.splice(target, 0, moved as Row);
  return out;
}

export function moveRowTo(rows: readonly Row[], from: number, to: number): Row[] {
  if (from === to || from < 0 || from >= rows.length || to < 0 || to >= rows.length) {
    return rows.slice();
  }
  const out = rows.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved as Row);
  return out;
}

export function removeRow(rows: readonly Row[], index: number): Row[] {
  return rows.filter((_, i) => i !== index);
}

/**
 * Sort by the chart position of the requested date (month = 16th, year = 2 July), so
 * the sheet order matches the chart. Rows without a parsable date keep their relative
 * order after the dated ones; empty rows stay last.
 */
export function sortByDate(
  rows: readonly Row[],
  today: CivilDate,
  direction: "asc" | "desc",
): Row[] {
  const dated: { row: Row; key: number }[] = [];
  const undated: Row[] = [];
  const empty: Row[] = [];
  for (const row of rows) {
    if (isBlank(row)) {
      empty.push(row);
      continue;
    }
    try {
      dated.push({ row, key: midpointDayNumber(parseDate(row.date, today)) });
    } catch {
      undated.push(row);
    }
  }
  const sign = direction === "asc" ? 1 : -1;
  dated.sort((a, b) => sign * (a.key - b.key));
  return [...dated.map((entry) => entry.row), ...undated, ...empty];
}

/** Write pasted text into the sheet from `startRow`, growing it as needed. */
export function applyPaste(
  rows: readonly Row[],
  startRow: number,
  startField: Field,
  pasted: PastedTable,
): Row[] {
  const out = rows.slice();
  const put = (index: number, field: Field, value: string) => {
    while (out.length <= index) out.push(newRow());
    out[index] = { ...(out[index] as Row), [field]: value };
  };
  if (pasted.kind === "records") {
    pasted.records.forEach((record, i) => {
      for (const field of EDITABLE_FIELDS) put(startRow + i, field, record[field]);
    });
  } else {
    const first = EDITABLE_FIELDS.indexOf(startField);
    pasted.cells.forEach((cells, i) => {
      cells.forEach((value, j) => {
        const field = EDITABLE_FIELDS[first + j];
        if (field) put(startRow + i, field, value);
      });
    });
  }
  return out;
}
