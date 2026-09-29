import {
  type CivilDate,
  type ExportRow,
  exportCsv,
  type ImportError,
  importCsv,
} from "@goldvalue/core";
import type { RowResult } from "../store/compute";
import { isBlank, newRow, normalize, type Row } from "../store/rows-logic";

/** FR14: files above this size are refused before they are read. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const MAX_IMPORT_LABEL = "5 MB";

export interface ImportOutcome {
  rows: Row[];
  extraColumns: string[];
  /** Number of data lines that became rows. */
  loaded: number;
  errors: ImportError[];
}

/**
 * Turn CSV text into sheet rows per FR14/FR16 (core's `importCsv` owns the format:
 * header aliases, ignored computed columns, passthrough columns). Bad lines are
 * reported and the good ones load. Throws `CsvFormatError` when the file has no
 * usable header.
 */
export function importSheet(text: string, today: CivilDate): ImportOutcome {
  const imported = importCsv(text, today);
  const rows = imported.rows.map((row) =>
    newRow({ amount: row.amount, date: row.date, label: row.label, extra: row.extra }),
  );
  return {
    rows: normalize(rows),
    extraColumns: imported.columns,
    loaded: rows.length,
    errors: imported.errors,
  };
}

export interface ExportOutcome {
  csv: string;
  exported: number;
  /** Rows left out because they have no computed value (errors, incomplete rows). */
  skipped: number;
}

/**
 * The FR15 file for the sheet: every row with a computed value, in sheet order, with the
 * CLI's rounding and LF line endings (`exportCsv` in core). Rows without a value are not
 * exported.
 */
export function exportSheet(
  rows: readonly Row[],
  results: readonly RowResult[],
  extraColumns: readonly string[],
): ExportOutcome {
  const out: ExportRow[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const result = results[index];
    if (result?.status === "ok") {
      out.push({
        date: row.date,
        amount: row.amount,
        currency: "USD",
        label: row.label,
        extra: extraColumns.map((_, i) => row.extra[i] ?? ""),
        result: result.conversion,
      });
    } else if (!isBlank(row)) {
      skipped++;
    }
  });
  return { csv: exportCsv(extraColumns, out), exported: out.length, skipped };
}
