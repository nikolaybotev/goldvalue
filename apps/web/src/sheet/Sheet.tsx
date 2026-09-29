import { CURRENCIES } from "@goldvalue/core";
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { MAX_IMPORT_LABEL } from "../io/csv-io";
import { formatPrice, formatUnit, sourceBadge } from "../lib/format";
import { fxStrong, fxWarns } from "../lib/fx-display";
import type { RowResult } from "../store/compute";
import { monthlyStatus } from "../store/data";
import { currency, fxStatus, setCurrency } from "../store/fx";
import { isBlank, type Row } from "../store/rows-logic";
import { results, rows, settings, updateSettings } from "../store/sheet-store";
import {
  clearSheet,
  commitEdit,
  deleteAt,
  exportFile,
  importFile,
  importReport,
  liveInput,
  moveRowAt,
  moveRowToIndex,
  nextSort,
  notice,
  onGridKeyDown,
  onGridPaste,
  setActive,
  sortSheet,
  startEdit,
  undoClear,
  undoSnapshot,
} from "./controller";
import {
  active,
  type ColId,
  clampPosition,
  editing,
  focusTick,
  isEditable,
  navColumns,
} from "./nav";

const COLUMN_LABEL: Record<ColId, { text: string; title: string }> = {
  amount: { text: "Amount", title: "Amount in the sheet currency; negative values are allowed" },
  date: {
    text: "Date",
    title: "YYYY, YYYY-MM, YYYY-MM-DD, Mar 1975, 03/14/1975, or today",
  },
  label: { text: "Label", title: "Optional note that is kept in exports and chart tooltips" },
  gb: { text: "GB", title: "Goldbacks: 1/1000 troy oz of gold" },
  gbd: { text: "GBD", title: "Gold-backed dollars: 1/50 troy oz of gold" },
  oz: { text: "Troy oz", title: "Troy ounces of gold" },
  price: {
    text: "Price used",
    title: "Gold price per troy oz, its source, and how it was resolved",
  },
};

/** A file is being dragged over the page (FR14 drag-drop). */
const fileDrag = signal(false);
const MAX_LISTED_ERRORS = 100;

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/** Accept a dropped CSV anywhere on the page, so a miss never navigates away from the app. */
function useFileDrop(): void {
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      fileDrag.value = true;
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) fileDrag.value = false;
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      fileDrag.value = false;
      const file = event.dataTransfer?.files[0];
      if (file) void importFile(file);
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, []);
}

function columnHeading(col: ColId, ccy: string): { text: string; title: string } {
  if (col === "amount") {
    return {
      text: `Amount (${ccy})`,
      title: `Amount in ${ccy}; negative values are allowed`,
    };
  }
  return COLUMN_LABEL[col];
}

function ImportReport() {
  const report = importReport.value;
  if (report === null) return null;
  if (report.failure !== null) {
    return (
      <div class="import-report is-failure" role="alert" data-testid="import-report">
        <p>{report.failure}</p>
      </div>
    );
  }
  if (report.errors.length === 0 && report.warnings.length === 0) return null;
  const listed = report.errors.slice(0, MAX_LISTED_ERRORS);
  const hidden = report.errors.length - listed.length;
  return (
    <div
      class="import-report"
      role="group"
      aria-label={report.errors.length > 0 ? "Import errors" : "Import warnings"}
      data-testid="import-report"
    >
      {report.warnings.map((warning) => (
        <p key={warning} class="import-warning" data-testid="import-warning" role="status">
          {warning}
        </p>
      ))}
      {report.errors.length > 0 && (
        <p>
          {report.file}: {report.loaded} {report.loaded === 1 ? "row" : "rows"} loaded,{" "}
          {report.errors.length} {report.errors.length === 1 ? "line" : "lines"} skipped.
        </p>
      )}
      {listed.length > 0 && (
        <ul>
          {listed.map((error) => (
            <li key={`${error.line}:${error.message}`}>
              Line {error.line}: {error.message}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p class="muted">and {hidden} more.</p>}
    </div>
  );
}

let dragFrom: number | null = null;
let pressedOnActive = false;

function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

function PriceCell({ result, rowId }: { result: RowResult; rowId: string }) {
  switch (result.status) {
    case "empty":
      return null;
    case "unavailable": {
      if (result.kind === "fx") {
        const failed = fxStatus.value.phase === "failed";
        return (
          <span class="muted">
            {failed ? "Exchange rates unavailable" : "Loading exchange rates"}
          </span>
        );
      }
      const state = monthlyStatus.value.state;
      return (
        <span class="muted">
          {state === "loading" ? "Loading prices" : "Price data unavailable"}
        </span>
      );
    }
    case "incomplete":
      return <span class="muted">{result.hint}</span>;
    case "error":
      return (
        <span class="error" id={`err-${rowId}`}>
          {[result.errors.amount, result.errors.date].filter(Boolean).join("; ")}
        </span>
      );
    case "ok": {
      const { conversion } = result;
      const badge = sourceBadge(conversion.price_source);
      const warn = fxWarns(conversion.fx_mode);
      return (
        <span class="price" data-note={conversion.note}>
          {warn && (
            <span
              class={`fx-marker${fxStrong(conversion.fx_mode) ? " is-strong" : ""}`}
              data-testid="fx-marker"
              data-fx-mode={conversion.fx_mode}
              title={conversion.fx_note ?? ""}
            >
              <span aria-hidden="true">!</span>
              <span class="sr-only">{conversion.fx_note}</span>
            </span>
          )}
          <span class="price-value">{formatPrice(conversion.gold_usd_per_oz)}</span>
          <span class="badge" title={badge.full}>
            {badge.short}
          </span>
          <span class="sr-only">{`, ${conversion.note}`}</span>
        </span>
      );
    }
  }
}

function cellTitle(result: RowResult): string | undefined {
  if (result.status !== "ok") return undefined;
  const { conversion } = result;
  return `${conversion.note} (effective ${conversion.effective}; ${conversion.price_source}; $${conversion.gold_usd_per_oz}/oz)`;
}

function unitCell(result: RowResult, key: "GB" | "GBD" | "troy_oz") {
  if (result.status !== "ok") return { text: "", value: undefined };
  const value = result.conversion[key];
  return { text: formatUnit(value), value: String(value) };
}

function RowView({ row, index, result }: { row: Row; index: number; result: RowResult }) {
  const cols = navColumns.value;
  const pos = clampPosition(active.value, rows.value.length, cols);
  const edit = editing.value;
  const errors = result.status === "error" ? result.errors : {};
  const blank = isBlank(row);
  const last = index === rows.value.length - 1;
  const ccy = currency.value;
  const mode = result.status === "ok" ? result.conversion.fx_mode : null;
  const warn = fxWarns(mode);

  const renderCell = (col: ColId) => {
    const isActive = pos.row === index && pos.col === col;
    const common = {
      role: "gridcell" as const,
      "data-pos": `${index}:${col}`,
      "aria-colindex": cols.indexOf(col) + 2,
      tabIndex: isActive ? 0 : -1,
      class: `cell col-${col}${isActive ? " is-active" : ""}`,
      onMouseDown: () => {
        const current = active.peek();
        pressedOnActive = current.row === index && current.col === col;
      },
      onFocus: () => {
        const current = active.peek();
        if (current.row !== index || current.col !== col) setActive({ row: index, col });
      },
      onClick: () => {
        setActive({ row: index, col });
        if (isEditable(col) && (pressedOnActive || coarsePointer()) && editing.peek() === null) {
          startEdit(index, col);
        }
        pressedOnActive = false;
      },
    };
    if (isEditable(col)) {
      const invalid = col === "amount" ? errors.amount : col === "date" ? errors.date : undefined;
      const isEditing = edit?.id === row.id && edit.field === col;
      return (
        <td
          key={col}
          {...common}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `err-${row.id}` : undefined}
          onDblClick={() => startEdit(index, col)}
        >
          {isEditing ? (
            <input
              class="cell-input"
              type="text"
              defaultValue={row[col]}
              aria-label={`${columnHeading(col, ccy).text}, row ${index + 1}`}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              onInput={(event) => liveInput(row.id, col, (event.target as HTMLInputElement).value)}
              onBlur={() => {
                if (editing.peek()?.id === row.id) commitEdit();
              }}
            />
          ) : (
            <span class="cell-text">{row[col]}</span>
          )}
        </td>
      );
    }
    if (col === "price") {
      return (
        <td key={col} {...common} aria-readonly="true" title={cellTitle(result)}>
          <PriceCell result={result} rowId={row.id} />
        </td>
      );
    }
    const unit = unitCell(result, col === "gb" ? "GB" : col === "gbd" ? "GBD" : "troy_oz");
    return (
      <td key={col} {...common} aria-readonly="true" data-value={unit.value}>
        {unit.text}
      </td>
    );
  };

  return (
    <tr
      role="row"
      aria-rowindex={index + 2}
      class={`sheet-row${pos.row === index ? " is-active-row" : ""}${blank ? " is-blank" : ""}${
        warn ? " is-fx-warn" : ""
      }${fxStrong(mode) ? " is-fx-strong" : ""}`}
      data-fx-mode={mode ?? undefined}
      onDragOver={(event) => {
        if (dragFrom !== null) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragFrom !== null) moveRowToIndex(dragFrom, index);
        dragFrom = null;
      }}
    >
      <th scope="row" role="rowheader" class="rownum">
        {blank ? (
          <span class="rownum-text">{index + 1}</span>
        ) : (
          <span
            class="grip"
            draggable
            title="Drag to reorder"
            onDragStart={(event) => {
              dragFrom = index;
              const tr = (event.currentTarget as HTMLElement).closest("tr");
              if (tr && event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index + 1));
                event.dataTransfer.setDragImage(tr, 0, 0);
              }
            }}
            onDragEnd={() => {
              dragFrom = null;
            }}
          >
            {index + 1}
          </span>
        )}
      </th>
      {cols.map(renderCell)}
      <td role="gridcell" class="cell col-actions" aria-colindex={cols.length + 2}>
        {!blank && (
          <span class="row-actions">
            <button
              type="button"
              class="icon-btn"
              tabIndex={-1}
              aria-label={`Move row ${index + 1} up`}
              title="Move up (Alt+Up)"
              disabled={index === 0}
              onClick={() => moveRowAt(index, -1)}
            >
              <span aria-hidden="true">&#8593;</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              tabIndex={-1}
              aria-label={`Move row ${index + 1} down`}
              title="Move down (Alt+Down)"
              disabled={last || index === rows.value.length - 2}
              onClick={() => moveRowAt(index, 1)}
            >
              <span aria-hidden="true">&#8595;</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              tabIndex={-1}
              aria-label={`Delete row ${index + 1}`}
              title="Delete row (Alt+Delete)"
              onClick={() => deleteAt(index)}
            >
              <span aria-hidden="true">&#215;</span>
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

function ColumnToggle({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" class="toggle" aria-pressed={pressed} onClick={onToggle}>
      {label}
    </button>
  );
}

function ActiveDetail() {
  const list = rows.value;
  const cols = navColumns.value;
  const pos = clampPosition(active.value, list.length, cols);
  const result = results.value[pos.row];
  if (result?.status !== "ok") {
    return (
      <p class="detail muted">
        Select a row with an amount and a date to see the price and how it was resolved.
      </p>
    );
  }
  const { conversion } = result;
  return (
    <p class="detail" data-testid="row-detail">
      <strong>Row {pos.row + 1}:</strong> {conversion.note}. Price{" "}
      {formatPrice(conversion.gold_usd_per_oz)} per troy oz ({conversion.price_source}; effective{" "}
      {conversion.effective}).{conversion.fx_note ? ` ${conversion.fx_note}` : ""}
    </p>
  );
}

export function Sheet() {
  const list = rows.value;
  const res = results.value;
  const cols = navColumns.value;
  const { showLabel, showGbd, showOz } = settings.value;
  const ccy = currency.value;
  const tick = focusTick.value;
  const pos = clampPosition(active.value, list.length, cols);
  const gridRef = useRef<HTMLTableElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useFileDrop();

  useLayoutEffect(() => {
    if (tick === 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    const input = grid.querySelector<HTMLInputElement>("input.cell-input");
    if (input) {
      if (document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      return;
    }
    grid.querySelector<HTMLElement>(`td[data-pos="${pos.row}:${pos.col}"]`)?.focus();
  }, [tick]);

  return (
    <section
      class={`sheet${fileDrag.value ? " is-file-drag" : ""}`}
      aria-labelledby="sheet-heading"
    >
      <div class="toolbar">
        <h2 id="sheet-heading">Sheet</h2>
        <label class="currency-field">
          Currency
          <select
            data-testid="currency"
            value={ccy}
            onChange={(event) => setCurrency((event.currentTarget as HTMLSelectElement).value)}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <div class="toolbar-actions">
          <button type="button" class="btn" onClick={sortSheet}>
            Sort by date
            <span class="btn-hint" aria-hidden="true">
              {nextSort.value === "asc" ? " (oldest first)" : " (newest first)"}
            </span>
          </button>
          <button
            type="button"
            class="btn"
            title={`Replace the sheet with a CSV file (up to ${MAX_IMPORT_LABEL}); you can also drop a file on the page`}
            onClick={() => fileRef.current?.click()}
          >
            Import CSV
          </button>
          <input
            ref={fileRef}
            class="sr-only"
            type="file"
            accept=".csv,text/csv,text/plain"
            tabIndex={-1}
            aria-label="CSV file to import"
            data-testid="import-input"
            onChange={(event) => {
              const input = event.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void importFile(file);
              input.value = "";
            }}
          />
          <button
            type="button"
            class="btn"
            title="Download the rows with their computed gold values as CSV"
            onClick={exportFile}
          >
            Export CSV
          </button>
          <button type="button" class="btn" onClick={clearSheet}>
            Clear
          </button>
        </div>
        <div class="toolbar-toggles" role="group" aria-label="Columns">
          <ColumnToggle
            label="Label"
            pressed={showLabel}
            onToggle={() => updateSettings({ showLabel: !showLabel })}
          />
          <ColumnToggle
            label="GBD"
            pressed={showGbd}
            onToggle={() => updateSettings({ showGbd: !showGbd })}
          />
          <ColumnToggle
            label="Troy oz"
            pressed={showOz}
            onToggle={() => updateSettings({ showOz: !showOz })}
          />
        </div>
      </div>
      <p class="notice" role="status">
        {notice.value}
        {undoSnapshot.value && notice.value.startsWith(undoSnapshot.value.notice) && (
          <>
            {" "}
            <button type="button" class="link-btn" onClick={undoClear}>
              Undo
            </button>
          </>
        )}
      </p>
      <ImportReport />
      <div class="grid-scroll">
        <table
          class="grid"
          role="grid"
          aria-label={`Amounts in ${ccy} by date, converted to gold`}
          aria-rowcount={list.length + 1}
          aria-colcount={cols.length + 2}
          ref={gridRef}
          onKeyDown={onGridKeyDown}
          onPaste={onGridPaste}
        >
          <thead>
            <tr role="row" aria-rowindex={1}>
              <th scope="col" role="columnheader" class="rownum" aria-colindex={1}>
                <span class="sr-only">Row</span>
              </th>
              {cols.map((col, i) => {
                const heading = columnHeading(col, ccy);
                return (
                  <th
                    key={col}
                    scope="col"
                    role="columnheader"
                    aria-colindex={i + 2}
                    class={`col-${col}`}
                    title={heading.title}
                  >
                    {heading.text}
                  </th>
                );
              })}
              <th
                scope="col"
                role="columnheader"
                aria-colindex={cols.length + 2}
                class="col-actions"
              >
                <span class="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((row, index) => (
              <RowView key={row.id} row={row} index={index} result={res[index] as RowResult} />
            ))}
          </tbody>
        </table>
      </div>
      <ActiveDetail />
      <p class="keys muted">
        Arrows move, Enter or F2 edits, Tab moves right, Esc cancels, Alt+Up/Down moves a row,
        Alt+Delete removes it. Paste rows from a spreadsheet or CSV to fill the sheet.
      </p>
    </section>
  );
}
