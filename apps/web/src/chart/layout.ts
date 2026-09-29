import {
  type ScaleContinuousNumeric,
  type ScaleTime,
  scaleLinear,
  scaleLog,
  scaleUtc,
} from "d3-scale";
import { line } from "d3-shape";
import type { AxisUnit, ChartPoint, PointGroup } from "./model";

const DAY_MS = 86_400_000;
export const POINT_SPACING = 9;

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlacedPoint {
  point: ChartPoint;
  /** Pixel position inside the plot area; side-by-side points are offset in x. */
  px: number;
  py: number;
  /** Pixel y of the nominal amount on the right axis (only with the overlay). */
  ny: number | null;
}

export interface PlacedGroup {
  x: number;
  cx: number;
  points: PlacedPoint[];
}

export interface ChartLayout {
  width: number;
  height: number;
  margins: Margins;
  innerWidth: number;
  innerHeight: number;
  xScale: ScaleTime<number, number>;
  yScale: ScaleContinuousNumeric<number, number>;
  y2Scale: ScaleContinuousNumeric<number, number> | null;
  log: boolean;
  groups: PlacedGroup[];
  placed: PlacedPoint[];
  linePath: string;
  overlayPath: string | null;
  zeroY: number | null;
}

export interface LayoutOptions {
  width: number;
  groups: readonly PointGroup[];
  unit: AxisUnit;
  log: boolean;
  overlay: boolean;
}

export function chartHeight(width: number): number {
  return Math.max(240, Math.min(420, Math.round(width * 0.5)));
}

function padded(min: number, max: number): [number, number] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

function makeYScale(
  values: readonly number[],
  log: boolean,
  range: [number, number],
): ScaleContinuousNumeric<number, number> {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (log) {
    const lo = min === max ? min / 1.5 : min / 1.2;
    const hi = min === max ? max * 1.5 : max * 1.2;
    return scaleLog<number, number>().domain([lo, hi]).range(range).nice();
  }
  const [lo, hi] = padded(min, max);
  return scaleLinear<number, number>().domain([lo, hi]).range(range).nice();
}

export function computeLayout(options: LayoutOptions): ChartLayout {
  const { width, groups, log, overlay } = options;
  const height = chartHeight(width);
  const margins: Margins = { top: 16, right: overlay ? 64 : 20, bottom: 40, left: 64 };
  const innerWidth = Math.max(40, width - margins.left - margins.right);
  const innerHeight = Math.max(40, height - margins.top - margins.bottom);

  const points = groups.flatMap((g) => g.points);
  const xs = groups.map((g) => g.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const span = maxX - minX;
  const pad = span === 0 ? 183 : Math.max(span * 0.04, 20);
  const xScale = scaleUtc<number, number>()
    .domain([new Date((minX - pad) * DAY_MS), new Date((maxX + pad) * DAY_MS)])
    .range([0, innerWidth]);

  const yScale = makeYScale(
    points.map((p) => p.value),
    log,
    [innerHeight, 0],
  );
  const y2Scale = overlay
    ? makeYScale(
        points.map((p) => p.amount),
        log,
        [innerHeight, 0],
      )
    : null;

  const placed: PlacedPoint[] = [];
  const placedGroups: PlacedGroup[] = groups.map((group) => {
    const cx = xScale(new Date(group.x * DAY_MS));
    const count = group.points.length;
    const members = group.points.map((point, i) => {
      const member: PlacedPoint = {
        point,
        px: cx + (i - (count - 1) / 2) * POINT_SPACING,
        py: yScale(point.value),
        ny: y2Scale ? y2Scale(point.amount) : null,
      };
      placed.push(member);
      return member;
    });
    return { x: group.x, cx, points: members };
  });

  const path = line<PlacedPoint>()
    .x((p) => p.px)
    .y((p) => p.py);
  const overlayLine = line<PlacedPoint>()
    .x((p) => p.px)
    .y((p) => p.ny ?? 0);
  const [d0, d1] = yScale.domain();
  const crossesZero = !log && (d0 ?? 0) < 0 && (d1 ?? 0) > 0;

  return {
    width,
    height,
    margins,
    innerWidth,
    innerHeight,
    xScale,
    yScale,
    y2Scale,
    log,
    groups: placedGroups,
    placed,
    linePath: placed.length > 1 ? (path(placed) ?? "") : "",
    overlayPath: overlay && placed.length > 1 ? (overlayLine(placed) ?? "") : null,
    zeroY: crossesZero ? yScale(0) : null,
  };
}

export function nearestGroup(
  layout: ChartLayout,
  x: number,
  y: number,
  threshold = 32,
): PlacedGroup | null {
  let best: PlacedGroup | null = null;
  let bestDistance = threshold;
  for (const group of layout.groups) {
    for (const p of group.points) {
      const distance = Math.hypot(p.px - x, p.py - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = group;
      }
    }
  }
  return best;
}
