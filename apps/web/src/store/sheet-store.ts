import type { SmoothYears } from "@goldvalue/core";
import { computed, effect, signal } from "@preact/signals";
import type { AxisUnit } from "../chart/model";
import { localToday } from "../lib/clock";
import { computeRow, type RowResult } from "./compute";
import { table } from "./data";
import { currency, fxRates } from "./fx";
import { newRow, normalize, type Row } from "./rows-logic";
import { readJson, writeJson } from "./storage";

const ROWS_KEY = "goldvalue:v1:rows";
const SETTINGS_KEY = "goldvalue:v1:settings";

const text = (value: unknown) => (typeof value === "string" ? value : "");

function loadSheet(): { rows: Row[]; extraColumns: string[] } {
  const stored = readJson(ROWS_KEY) as {
    v?: number;
    rows?: unknown;
    extraColumns?: unknown;
  } | null;
  const rows: Row[] = [];
  let extraColumns: string[] = [];
  if (stored?.v === 1 && Array.isArray(stored.rows)) {
    if (Array.isArray(stored.extraColumns)) extraColumns = stored.extraColumns.map(text);
    for (const entry of stored.rows as Record<string, unknown>[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const extra = Array.isArray(entry.extra) ? entry.extra.map(text) : [];
      rows.push(
        newRow({
          amount: text(entry.amount),
          date: text(entry.date),
          label: text(entry.label),
          extra: extraColumns.map((_, i) => extra[i] ?? ""),
        }),
      );
    }
  }
  return { rows: normalize(rows), extraColumns };
}

const loaded = loadSheet();
export const rows = signal<Row[]>(loaded.rows);
/** Names of CSV passthrough columns kept from the last import (FR14); exported unchanged. */
export const extraColumns = signal<string[]>(loaded.extraColumns);

effect(() => {
  const list = rows.value;
  let end = list.length;
  while (
    end > 0 &&
    list[end - 1]?.amount === "" &&
    list[end - 1]?.date === "" &&
    list[end - 1]?.label === ""
  ) {
    end--;
  }
  const columns = extraColumns.value;
  writeJson(ROWS_KEY, {
    v: 1,
    extraColumns: columns,
    rows: list.slice(0, end).map(({ amount, date, label, extra }) => ({
      amount,
      date,
      label,
      ...(columns.length > 0 ? { extra } : {}),
    })),
  });
});

/** Sheet-wide gold price (D19). `partial` is per row, not a setting. */
export type GoldPriceMode = "spot" | "smoothed";

export interface Settings {
  showLabel: boolean;
  showGbd: boolean;
  showOz: boolean;
  /** Y axis unit the chart opens with (D11); changed only by "Save as default". */
  axisDefault: AxisUnit;
  logScale: boolean;
  nominalOverlay: boolean;
  /** Width of the sheet as a percentage of the workspace in the wide layout (FR17). */
  splitPercent: number;
  /** Chart collapsed in the narrow layout (FR17). */
  chartCollapsed: boolean;
  /** Spot is the default (D19). Remembered with the other settings (FR21). */
  goldMode: GoldPriceMode;
  /** Trailing window. Used only while `goldMode` is smoothed. Default 10 (D16). */
  smoothYears: SmoothYears;
  /** Spot series on the chart. Off until the user turns it on (D20). */
  spotOverlay: boolean;
}

export const SPLIT_MIN = 30;
export const SPLIT_MAX = 75;

const DEFAULT_SETTINGS: Settings = {
  showLabel: true,
  showGbd: true,
  showOz: true,
  axisDefault: "GB",
  logScale: false,
  nominalOverlay: false,
  splitPercent: 58,
  chartCollapsed: false,
  goldMode: "spot",
  smoothYears: 10,
  spotOverlay: false,
};

function smoothYearsOf(value: unknown): SmoothYears {
  return value === 5 || value === 10 || value === 20 ? value : 10;
}

function loadSettings(): Settings {
  const stored = readJson(SETTINGS_KEY) as (Partial<Settings> & { v?: number }) | null;
  const settings = { ...DEFAULT_SETTINGS };
  if (stored?.v === 1) {
    for (const key of [
      "showLabel",
      "showGbd",
      "showOz",
      "logScale",
      "nominalOverlay",
      "chartCollapsed",
    ] as const) {
      if (typeof stored[key] === "boolean") settings[key] = stored[key];
    }
    if (
      typeof stored.splitPercent === "number" &&
      stored.splitPercent >= SPLIT_MIN &&
      stored.splitPercent <= SPLIT_MAX
    ) {
      settings.splitPercent = stored.splitPercent;
    }
    if (
      stored.axisDefault === "GB" ||
      stored.axisDefault === "GBD" ||
      stored.axisDefault === "OZ"
    ) {
      settings.axisDefault = stored.axisDefault;
    }
    if (stored.goldMode === "spot" || stored.goldMode === "smoothed") {
      settings.goldMode = stored.goldMode;
    }
    settings.smoothYears = smoothYearsOf(stored.smoothYears);
    if (typeof stored.spotOverlay === "boolean") settings.spotOverlay = stored.spotOverlay;
  }
  return settings;
}

export const settings = signal<Settings>(loadSettings());

effect(() => {
  writeJson(SETTINGS_KEY, { v: 1, ...settings.value });
});

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export const today = signal(localToday());

export function refreshToday(): void {
  const next = localToday();
  const current = today.peek();
  if (next.year !== current.year || next.month !== current.month || next.day !== current.day) {
    today.value = next;
  }
}

const cache = new WeakMap<
  Row,
  {
    table: unknown;
    day: string;
    currency: string;
    fx: unknown;
    mode: GoldPriceMode;
    /** Selected trailing window (5, 10, or 20), included even while spot is selected. */
    window: SmoothYears;
    result: RowResult;
  }
>();

/** One result per row. The cache key includes the gold mode and window, or a switch would reuse spot rows. */
export const results = computed<RowResult[]>(() => {
  const gold = table.value;
  const day = today.value;
  const ccy = currency.value;
  const rates = fxRates.value;
  const mode = settings.value.goldMode;
  const years = settings.value.smoothYears;
  const key = `${day.year}-${day.month}-${day.day}|${mode}|${years}`;
  const smooth = mode === "smoothed" ? years : undefined;
  return rows.value.map((row) => {
    const hit = cache.get(row);
    if (
      hit &&
      hit.table === gold &&
      hit.day === key &&
      hit.currency === ccy &&
      hit.fx === rates &&
      hit.mode === mode &&
      hit.window === years
    ) {
      return hit.result;
    }
    const result = computeRow(row, gold, day, ccy, rates, smooth);
    cache.set(row, {
      table: gold,
      day: key,
      currency: ccy,
      fx: rates,
      mode,
      window: years,
      result,
    });
    return result;
  });
});
