import { signal } from "@preact/signals";
import { exportSheet, importSheet, MAX_IMPORT_BYTES, MAX_IMPORT_LABEL } from "../io/csv-io";
import { downloadBlob } from "../lib/download";
import { parsePasted } from "../lib/paste";
import {
  applyPaste,
  type Field,
  isBlank,
  moveRow,
  moveRowTo,
  newRow,
  normalize,
  type Row,
  removeRow,
  setField,
  sortByDate,
} from "../store/rows-logic";
import { extraColumns, results, rows, today } from "../store/sheet-store";
import {
  active,
  type ColId,
  clampPosition,
  editing,
  isEditable,
  moveBy,
  navColumns,
  type Position,
  requestFocus,
  stepCell,
} from "./nav";

/** Status text for the polite live region under the toolbar. */
export const notice = signal("");
/** What the last Clear or Import replaced, kept so it can be undone (`notice` says which). */
export const undoSnapshot = signal<{
  rows: Row[];
  extraColumns: string[];
  notice: string;
} | null>(null);
/** Outcome of the last CSV import: file name, loaded count, and one entry per bad line (FR16). */
export const importReport = signal<{
  file: string;
  loaded: number;
  errors: { line: number; message: string }[];
  failure: string | null;
} | null>(null);
/** Direction the next "Sort by date" press applies. */
export const nextSort = signal<"asc" | "desc">("asc");

const currentPosition = (): Position =>
  clampPosition(active.peek(), rows.peek().length, navColumns.peek());

export function go(pos: Position): void {
  active.value = clampPosition(pos, rows.peek().length, navColumns.peek());
  requestFocus();
}

export function setActive(pos: Position): void {
  active.value = clampPosition(pos, rows.peek().length, navColumns.peek());
}

export function startEdit(row: number, field: Field, replaceWith?: string): void {
  const target = rows.peek()[row];
  if (!target) return;
  editing.value = { id: target.id, field, original: target[field] };
  if (replaceWith !== undefined) {
    rows.value = normalize(setField(rows.peek(), target.id, field, replaceWith), false);
  }
  requestFocus();
}

export function commitEdit(): void {
  if (editing.peek() === null) return;
  editing.value = null;
  rows.value = normalize(rows.peek(), true);
}

export function cancelEdit(): void {
  const state = editing.peek();
  if (state === null) return;
  editing.value = null;
  rows.value = normalize(setField(rows.peek(), state.id, state.field, state.original), true);
}

/** Every keystroke updates the row, so the computed cells and the chart follow the caret. */
export function liveInput(id: string, field: Field, value: string): void {
  rows.value = normalize(setField(rows.peek(), id, field, value), false);
}

function editableAt(pos: Position): Field | null {
  return isEditable(pos.col) ? (pos.col as Field) : null;
}

export function moveRowAt(index: number, delta: -1 | 1): void {
  const list = rows.peek();
  if (index + delta < 0 || index + delta >= list.length) return;
  commitEdit();
  rows.value = normalize(moveRow(rows.peek(), index, delta), true);
  setActive({ row: index + delta, col: currentPosition().col });
  requestFocus();
  notice.value = `Row moved to position ${index + delta + 1}`;
}

export function deleteAt(index: number): void {
  commitEdit();
  const next = normalize(removeRow(rows.peek(), index), true);
  rows.value = next.length === 0 ? [newRow()] : next;
  setActive({ row: Math.min(index, rows.peek().length - 1), col: currentPosition().col });
  requestFocus();
  notice.value = `Row ${index + 1} deleted`;
}

export function moveRowToIndex(from: number, to: number): void {
  commitEdit();
  rows.value = normalize(moveRowTo(rows.peek(), from, to), true);
  setActive({ row: to, col: currentPosition().col });
  notice.value = `Row moved to position ${to + 1}`;
}

export function clearSheet(): void {
  commitEdit();
  const previous = rows.peek();
  undoSnapshot.value = previous.every(isBlank)
    ? null
    : { rows: previous, extraColumns: extraColumns.peek(), notice: "Sheet cleared" };
  rows.value = [newRow()];
  extraColumns.value = [];
  importReport.value = null;
  active.value = { row: 0, col: "amount" };
  notice.value = "Sheet cleared";
}

export function undoClear(): void {
  const previous = undoSnapshot.peek();
  if (!previous) return;
  undoSnapshot.value = null;
  extraColumns.value = previous.extraColumns;
  rows.value = normalize(previous.rows, true);
  notice.value = "Sheet restored";
}

/**
 * Replace the sheet with the rows of a CSV file (FR14, FR16). Lines that cannot be
 * parsed are listed in `importReport`; the rest load. The previous sheet can be
 * restored with Undo.
 */
export async function importFile(file: File): Promise<void> {
  commitEdit();
  if (file.size > MAX_IMPORT_BYTES) {
    importReport.value = {
      file: file.name,
      loaded: 0,
      errors: [],
      failure: `${file.name} is larger than ${MAX_IMPORT_LABEL}; nothing was imported.`,
    };
    notice.value = "Import failed";
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    importReport.value = {
      file: file.name,
      loaded: 0,
      errors: [],
      failure: `${file.name} could not be read.`,
    };
    notice.value = "Import failed";
    return;
  }
  try {
    const outcome = importSheet(text, today.peek());
    const previous = rows.peek();
    undoSnapshot.value = previous.every(isBlank)
      ? null
      : { rows: previous, extraColumns: extraColumns.peek(), notice: "Sheet imported" };
    extraColumns.value = outcome.extraColumns;
    rows.value = outcome.rows;
    active.value = { row: 0, col: "amount" };
    importReport.value = {
      file: file.name,
      loaded: outcome.loaded,
      errors: outcome.errors,
      failure: null,
    };
    const skipped = outcome.errors.length;
    notice.value = `Sheet imported: ${outcome.loaded} ${outcome.loaded === 1 ? "row" : "rows"} loaded${
      skipped > 0 ? `, ${skipped} ${skipped === 1 ? "line" : "lines"} skipped` : ""
    }`;
  } catch (error) {
    importReport.value = {
      file: file.name,
      loaded: 0,
      errors: [],
      failure: `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
    };
    notice.value = "Import failed";
  }
}

/** Download the sheet as the FR15 CSV (same columns, rounding, and LF endings as `--batch`). */
export function exportFile(): void {
  commitEdit();
  const outcome = exportSheet(rows.peek(), results.peek(), extraColumns.peek());
  if (outcome.exported === 0) {
    notice.value = "Nothing to export: no row has a computed value yet";
    return;
  }
  downloadBlob(new Blob([outcome.csv], { type: "text/csv;charset=utf-8" }), "goldvalue.csv");
  notice.value = `Exported ${outcome.exported} ${outcome.exported === 1 ? "row" : "rows"}${
    outcome.skipped > 0
      ? `; ${outcome.skipped} ${outcome.skipped === 1 ? "row" : "rows"} without a value left out`
      : ""
  }`;
}

export function sortSheet(): void {
  commitEdit();
  const direction = nextSort.peek();
  rows.value = normalize(sortByDate(rows.peek(), today.peek(), direction), true);
  nextSort.value = direction === "asc" ? "desc" : "asc";
  notice.value = `Sorted by date, ${direction === "asc" ? "oldest" : "newest"} first`;
}

function clearCell(pos: Position): void {
  const field = editableAt(pos);
  const row = rows.peek()[pos.row];
  if (!field || !row) return;
  rows.value = normalize(setField(rows.peek(), row.id, field, ""), true);
}

function navigateKey(event: KeyboardEvent): void {
  const pos = currentPosition();
  const count = rows.peek().length;
  const cols = navColumns.peek();
  const field = editableAt(pos);
  const handled = () => event.preventDefault();

  switch (event.key) {
    case "ArrowDown":
      handled();
      if (event.altKey) moveRowAt(pos.row, 1);
      else go(moveBy(pos, 1, 0, count, cols));
      return;
    case "ArrowUp":
      handled();
      if (event.altKey) moveRowAt(pos.row, -1);
      else go(moveBy(pos, -1, 0, count, cols));
      return;
    case "ArrowRight":
      handled();
      go(moveBy(pos, 0, 1, count, cols));
      return;
    case "ArrowLeft":
      handled();
      go(moveBy(pos, 0, -1, count, cols));
      return;
    case "Home":
      handled();
      go({ row: event.ctrlKey || event.metaKey ? 0 : pos.row, col: cols[0] as ColId });
      return;
    case "End":
      handled();
      go({
        row: event.ctrlKey || event.metaKey ? count - 1 : pos.row,
        col: cols[cols.length - 1] as ColId,
      });
      return;
    case "PageDown":
      handled();
      go(moveBy(pos, 10, 0, count, cols));
      return;
    case "PageUp":
      handled();
      go(moveBy(pos, -10, 0, count, cols));
      return;
    case "Tab": {
      const next = stepCell(pos, event.shiftKey ? -1 : 1, count, cols);
      if (next) {
        handled();
        go(next);
      }
      return;
    }
    case "Enter":
    case "F2":
      handled();
      if (field) startEdit(pos.row, field);
      else if (event.key === "Enter") go(moveBy(pos, event.shiftKey ? -1 : 1, 0, count, cols));
      return;
    case "Delete":
    case "Backspace":
      handled();
      if (event.altKey) deleteAt(pos.row);
      else clearCell(pos);
      return;
    default:
      if (field && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        handled();
        startEdit(pos.row, field, event.key);
      }
  }
}

function editKey(event: KeyboardEvent): void {
  const pos = currentPosition();
  const cols = navColumns.peek();
  switch (event.key) {
    case "Enter": {
      event.preventDefault();
      commitEdit();
      go(moveBy(pos, event.shiftKey ? -1 : 1, 0, rows.peek().length, cols));
      return;
    }
    case "Tab": {
      commitEdit();
      const next = stepCell(pos, event.shiftKey ? -1 : 1, rows.peek().length, cols);
      if (next) {
        event.preventDefault();
        go(next);
      }
      return;
    }
    case "Escape":
      event.preventDefault();
      cancelEdit();
      requestFocus();
      return;
    default:
  }
}

export function onGridKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement) {
    editKey(event);
    return;
  }
  if (target.closest("button") || !target.closest("td[data-pos]")) return;
  navigateKey(event);
}

export function onGridPaste(event: ClipboardEvent): void {
  const target = event.target as HTMLElement;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const pasted = parsePasted(text, today.peek());
  const pos = currentPosition();
  if (pasted === null) {
    if (target instanceof HTMLInputElement) return;
    const field = editableAt(pos);
    const row = rows.peek()[pos.row];
    if (field && row) {
      event.preventDefault();
      rows.value = normalize(setField(rows.peek(), row.id, field, text.trim()), true);
    }
    return;
  }
  event.preventDefault();
  commitEdit();
  const field = editableAt(pos) ?? "amount";
  rows.value = normalize(applyPaste(rows.peek(), pos.row, field, pasted), true);
  const count = pasted.kind === "records" ? pasted.records.length : pasted.cells.length;
  notice.value = `Pasted ${count} ${count === 1 ? "row" : "rows"}`;
  go({ row: pos.row, col: field as ColId });
}
