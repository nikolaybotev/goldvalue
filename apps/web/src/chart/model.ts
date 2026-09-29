import { type ConversionResult, formatIso, fromDayNumber, toDayNumber } from "@goldvalue/core";
import { midpoint } from "../lib/period";
import type { RowResult } from "../store/compute";
import type { Row } from "../store/rows-logic";

export type AxisUnit = "GB" | "GBD" | "OZ";

export const AXIS_UNITS: readonly { id: AxisUnit; short: string; title: string }[] = [
  { id: "GB", short: "GB", title: "Goldbacks (1/1000 troy oz)" },
  { id: "GBD", short: "GBD", title: "Gold-backed dollars (1/50 troy oz)" },
  { id: "OZ", short: "oz", title: "Troy ounces of gold" },
];

export function unitValue(conversion: ConversionResult, unit: AxisUnit): number {
  return unit === "GB" ? conversion.GB : unit === "GBD" ? conversion.GBD : conversion.troy_oz;
}

export interface ChartPoint {
  rowId: string;
  rowNumber: number;
  label: string;
  requested: string;
  amount: number;
  /** Gold value in the axis unit. */
  value: number;
  /** Day number (days since 1970-01-01) of the chart position (FR12). */
  x: number;
  plotted: string;
  effective: string;
  price: number;
  source: string;
  note: string;
  granularity: string;
}

export interface PointGroup {
  x: number;
  points: ChartPoint[];
}

/** Granularity as the tooltip states it, e.g. "year average of 191 fixes" (FR12). */
export function describeGranularity(conversion: ConversionResult): string {
  const { granularity, points, price_source: source } = conversion;
  const daily = source === "LBMA";
  if (granularity === "day") return daily ? "daily fix" : "monthly series value";
  if (daily) return `${granularity} average of ${points} ${points === 1 ? "fix" : "fixes"}`;
  if (granularity === "month") return "monthly series value";
  return `year average of ${points} monthly values`;
}

/** Valid rows as chart points, in date order (rows with the same date keep sheet order). */
export function buildPoints(
  rows: readonly Row[],
  results: readonly RowResult[],
  unit: AxisUnit,
): ChartPoint[] {
  const points: ChartPoint[] = [];
  rows.forEach((row, index) => {
    const result = results[index];
    if (result?.status !== "ok") return;
    const { conversion, period, amount } = result;
    const x = toDayNumber(midpoint(period));
    points.push({
      rowId: row.id,
      rowNumber: index + 1,
      label: row.label.trim(),
      requested: row.date.trim(),
      amount,
      value: unitValue(conversion, unit),
      x,
      plotted: formatIso(fromDayNumber(x)),
      effective: conversion.effective,
      price: conversion.gold_usd_per_oz,
      source: conversion.price_source,
      note: conversion.note,
      granularity: describeGranularity(conversion),
    });
  });
  return points.sort((a, b) => a.x - b.x || a.rowNumber - b.rowNumber);
}

/** Points with identical x share one tooltip and are drawn side by side (FR12). */
export function groupByX(points: readonly ChartPoint[]): PointGroup[] {
  const groups: PointGroup[] = [];
  for (const point of points) {
    const last = groups[groups.length - 1];
    if (last && last.x === point.x) last.points.push(point);
    else groups.push({ x: point.x, points: [point] });
  }
  return groups;
}

/** The log toggle is offered only while every plotted value is positive (FR10). */
export function logAvailable(points: readonly ChartPoint[], overlay: boolean): boolean {
  return points.length > 0 && points.every((p) => p.value > 0 && (!overlay || p.amount > 0));
}
