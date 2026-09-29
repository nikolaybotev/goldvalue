import { computed, signal } from "@preact/signals";
import type { Field } from "../store/rows-logic";
import { settings } from "../store/sheet-store";

export type ColId = "amount" | "date" | "label" | "gb" | "gbd" | "oz" | "price";

export const EDITABLE: readonly ColId[] = ["amount", "date", "label"];

export function isEditable(col: ColId): col is Field & ColId {
  return EDITABLE.includes(col);
}

/** Grid columns that are keyboard stops, in display order. */
export const navColumns = computed<ColId[]>(() => {
  const { showLabel, showGbd, showOz } = settings.value;
  const cols: ColId[] = ["amount", "date"];
  if (showLabel) cols.push("label");
  cols.push("gb");
  if (showGbd) cols.push("gbd");
  if (showOz) cols.push("oz");
  cols.push("price");
  return cols;
});

export interface Position {
  row: number;
  col: ColId;
}

export interface EditState {
  id: string;
  field: Field;
  original: string;
}

export const active = signal<Position>({ row: 0, col: "amount" });
export const editing = signal<EditState | null>(null);
export const focusTick = signal(0);

export function requestFocus(): void {
  focusTick.value += 1;
}

export function clampPosition(pos: Position, rowCount: number, cols: readonly ColId[]): Position {
  const row = Math.max(0, Math.min(rowCount - 1, pos.row));
  const col = cols.includes(pos.col) ? pos.col : ((cols[0] ?? "amount") as ColId);
  return { row, col };
}

/** Step one cell right (`+1`) or left (`-1`), wrapping to the neighbouring row. */
export function stepCell(
  pos: Position,
  delta: 1 | -1,
  rowCount: number,
  cols: readonly ColId[],
): Position | null {
  const index = cols.indexOf(pos.col);
  const next = index + delta;
  if (next >= 0 && next < cols.length) return { row: pos.row, col: cols[next] as ColId };
  const row = pos.row + delta;
  if (row < 0 || row >= rowCount) return null;
  return { row, col: (delta === 1 ? cols[0] : cols[cols.length - 1]) as ColId };
}

export function moveBy(
  pos: Position,
  dRow: number,
  dCol: number,
  rowCount: number,
  cols: readonly ColId[],
): Position {
  const index = Math.max(0, cols.indexOf(pos.col));
  const col = cols[Math.max(0, Math.min(cols.length - 1, index + dCol))] as ColId;
  return { row: Math.max(0, Math.min(rowCount - 1, pos.row + dRow)), col };
}
