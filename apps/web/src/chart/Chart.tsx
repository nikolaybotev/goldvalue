import { signal } from "@preact/signals";
import { axisBottom, axisLeft, axisRight } from "d3-axis";
import type { NumberValue } from "d3-scale";
import { select } from "d3-selection";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { downloadPng, downloadSvg } from "../export/chart-image";
import { sizeLabel } from "../export/size";
import { formatMoney, formatPrice, formatUnit, sourceBadge } from "../lib/format";
import { fxStrong, fxWarns } from "../lib/fx-display";
import { currency } from "../store/fx";
import { results, rows, settings, updateSettings } from "../store/sheet-store";
import { chartHeight, computeLayout, nearestGroup, type PlacedGroup } from "./layout";
import { AXIS_UNITS, type AxisUnit, buildPoints, groupByX, logAvailable } from "./model";

/** Y axis unit for this visit; it starts at the saved default (D11). */
const axisUnit = signal<AxisUnit>(settings.peek().axisDefault);

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 3 });

function exportError(error: unknown): string {
  return `Download failed: ${error instanceof Error ? error.message : String(error)}`;
}

function unitInfo(unit: AxisUnit) {
  return AXIS_UNITS.find((u) => u.id === unit) ?? (AXIS_UNITS[0] as (typeof AXIS_UNITS)[number]);
}

function Tooltip({
  group,
  unit,
  money,
  left,
  top,
  flip,
}: {
  group: PlacedGroup;
  unit: AxisUnit;
  money: string;
  left: number;
  top: number;
  flip: boolean;
}) {
  const short = unitInfo(unit).short;
  return (
    <div
      class="tooltip"
      aria-hidden="true"
      data-testid="chart-tooltip"
      style={
        flip ? { right: `${left}px`, top: `${top}px` } : { left: `${left}px`, top: `${top}px` }
      }
    >
      <ul>
        {group.points.map(({ point }) => (
          <li key={point.rowId}>
            <div class="tip-head">
              <strong>{point.label || `Row ${point.rowNumber}`}</strong>
              <span class="muted">
                {point.requested}
                {point.requested !== point.plotted && ` (plotted ${point.plotted})`}
              </span>
            </div>
            <div>
              {formatMoney(point.amount, money)} = <strong>{formatUnit(point.value)}</strong>{" "}
              {short}
            </div>
            <div class="muted">
              {formatPrice(point.price)}/oz, {sourceBadge(point.source).short}, {point.granularity}
            </div>
            {point.fxNote !== "" && (
              <div
                class={fxWarns(point.fxMode) ? "tip-fx" : "muted"}
                data-strong={fxStrong(point.fxMode) ? "true" : undefined}
                data-testid="chart-fx-note"
              >
                {point.fxNote}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Chart({ collapsible = false }: { collapsible?: boolean }) {
  const list = rows.value;
  const res = results.value;
  const { logScale, nominalOverlay, axisDefault, chartCollapsed } = settings.value;
  const collapsed = collapsible && chartCollapsed;
  const unit = axisUnit.value;
  const ccy = currency.value;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [exportState, setExportState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const y2AxisRef = useRef<SVGGElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<{
    x: number;
    group: PlacedGroup;
    px: number;
    py: number;
  } | null>(null);

  const points = buildPoints(list, res, unit);
  const groups = groupByX(points);
  const canLog = logAvailable(points, nominalOverlay);
  const layout =
    points.length > 0
      ? computeLayout({ width, groups, unit, log: logScale && canLog, overlay: nominalOverlay })
      : null;

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const next = Math.floor(wrap.clientWidth);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  });

  useLayoutEffect(() => {
    if (!layout) return;
    const { xScale, yScale, y2Scale, innerWidth, innerHeight, log } = layout;
    const format = (scale: typeof yScale) =>
      log ? scale.tickFormat(6, ",") : (value: NumberValue) => compact.format(Number(value));
    if (xAxisRef.current) {
      select(xAxisRef.current).call(
        axisBottom(xScale).ticks(Math.max(2, Math.floor(innerWidth / 90))),
      );
    }
    if (yAxisRef.current) {
      select(yAxisRef.current).call(
        axisLeft(yScale).ticks(6).tickSize(-innerWidth).tickFormat(format(yScale)),
      );
    }
    if (y2AxisRef.current && y2Scale) {
      select(y2AxisRef.current).call(
        axisRight(y2Scale)
          .ticks(Math.max(2, Math.floor(innerHeight / 50)))
          .tickFormat(format(y2Scale)),
      );
    }
  });

  const chooseUnit = (next: AxisUnit) => {
    axisUnit.value = next;
    setHover(null);
  };

  const onMove = (event: PointerEvent) => {
    if (!layout) return;
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const x = event.clientX - box.left - layout.margins.left;
    const y = event.clientY - box.top - layout.margins.top;
    const group = nearestGroup(layout, x, y);
    if (group) {
      const first = group.points[0];
      setHover({
        x: group.x,
        group,
        px: group.cx + layout.margins.left,
        py: (first ? first.py : y) + layout.margins.top,
      });
    } else if (event.pointerType === "mouse") setHover(null);
  };

  const saveSvg = () => {
    if (!svgRef.current) return;
    try {
      downloadSvg(svgRef.current);
      setExportState({ busy: false, error: null });
    } catch (error) {
      setExportState({ busy: false, error: exportError(error) });
    }
  };

  const savePng = async () => {
    if (!svgRef.current) return;
    setExportState({ busy: true, error: null });
    try {
      await downloadPng(svgRef.current);
      setExportState({ busy: false, error: null });
    } catch (error) {
      setExportState({ busy: false, error: exportError(error) });
    }
  };

  const info = unitInfo(unit);
  const summary =
    points.length === 0
      ? "Chart of gold value by date; no valid rows yet."
      : `Line chart of ${points.length} ${points.length === 1 ? "row" : "rows"} in ${info.title}, from ${
          points[0]?.plotted
        } to ${points[points.length - 1]?.plotted}. The sheet lists the same data.`;

  return (
    <section class="chart-panel" aria-labelledby="chart-heading">
      <div class="chart-head">
        <h2 id="chart-heading">Chart</h2>
        {collapsible && (
          <button
            type="button"
            class="btn"
            aria-expanded={!collapsed}
            aria-controls="chart-body"
            onClick={() => updateSettings({ chartCollapsed: !chartCollapsed })}
          >
            {collapsed ? "Show chart" : "Hide chart"}
          </button>
        )}
      </div>
      <div id="chart-body" hidden={collapsed}>
        <div class="toolbar">
          <fieldset class="toolbar-toggles">
            <legend class="sr-only">Y axis unit</legend>
            {AXIS_UNITS.map((u) => (
              <button
                key={u.id}
                type="button"
                class="toggle"
                aria-pressed={unit === u.id}
                title={u.title}
                onClick={() => chooseUnit(u.id)}
              >
                {u.short}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            class="btn"
            disabled={unit === axisDefault}
            onClick={() => updateSettings({ axisDefault: unit })}
          >
            {unit === axisDefault ? "Default axis" : "Save as default"}
          </button>
          <fieldset class="toolbar-toggles">
            <legend class="sr-only">Chart options</legend>
            <button
              type="button"
              class="toggle"
              aria-pressed={nominalOverlay}
              onClick={() => updateSettings({ nominalOverlay: !nominalOverlay })}
            >
              {`Nominal ${ccy}`}
            </button>
            {canLog && (
              <button
                type="button"
                class="toggle"
                aria-pressed={logScale}
                onClick={() => updateSettings({ logScale: !logScale })}
              >
                Log scale
              </button>
            )}
          </fieldset>
        </div>

        <div class="chart-wrap" ref={wrapRef}>
          {layout === null ? (
            <p class="chart-empty muted" data-testid="chart-empty">
              Enter an amount and a date in the sheet to see the chart.
            </p>
          ) : (
            <>
              <svg
                ref={svgRef}
                class="chart"
                data-testid="chart"
                data-unit={unit}
                data-log={layout.log ? "true" : "false"}
                role="img"
                aria-label={summary}
                xmlns="http://www.w3.org/2000/svg"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                onPointerMove={onMove}
                onPointerDown={onMove}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") setHover(null);
                }}
              >
                <g transform={`translate(${layout.margins.left},${layout.margins.top})`}>
                  <g class="axis axis-y" ref={yAxisRef} />
                  <g
                    class="axis axis-x"
                    ref={xAxisRef}
                    transform={`translate(0,${layout.innerHeight})`}
                  />
                  {layout.y2Scale && (
                    <g
                      class="axis axis-y2"
                      ref={y2AxisRef}
                      transform={`translate(${layout.innerWidth},0)`}
                    />
                  )}
                  {layout.zeroY !== null && (
                    <line
                      class="zero-line"
                      x1={0}
                      x2={layout.innerWidth}
                      y1={layout.zeroY}
                      y2={layout.zeroY}
                    />
                  )}
                  {hover && (
                    <line
                      class="guide"
                      x1={hover.group.cx}
                      x2={hover.group.cx}
                      y1={0}
                      y2={layout.innerHeight}
                    />
                  )}
                  {layout.overlayPath && <path class="overlay-line" d={layout.overlayPath} />}
                  {layout.y2Scale &&
                    layout.placed.map(
                      (p) =>
                        p.ny !== null && (
                          <rect
                            key={`n-${p.point.rowId}`}
                            class="overlay-mark"
                            data-testid="nominal-point"
                            x={p.px - 3}
                            y={p.ny - 3}
                            width={6}
                            height={6}
                          />
                        ),
                    )}
                  {layout.linePath && <path class="series-line" d={layout.linePath} />}
                  {layout.placed.map((p) => (
                    <circle
                      key={p.point.rowId}
                      class={`point${hover?.x === p.point.x ? " is-hover" : ""}${
                        fxWarns(p.point.fxMode) ? " is-fx" : ""
                      }${fxStrong(p.point.fxMode) ? " is-strong" : ""}`}
                      data-testid="point"
                      data-row={p.point.rowNumber}
                      data-date={p.point.plotted}
                      data-fx-mode={p.point.fxMode ?? undefined}
                      data-x={p.px.toFixed(2)}
                      data-y={p.py.toFixed(2)}
                      cx={p.px}
                      cy={p.py}
                      r={4.5}
                    />
                  ))}
                </g>
                <text
                  class="axis-title"
                  transform={`translate(14,${layout.margins.top + layout.innerHeight / 2}) rotate(-90)`}
                  text-anchor="middle"
                >
                  {info.short}
                  {layout.log ? " (log)" : ""}
                </text>
                {layout.y2Scale && (
                  <text
                    class="axis-title"
                    transform={`translate(${layout.width - 12},${layout.margins.top + layout.innerHeight / 2}) rotate(90)`}
                    text-anchor="middle"
                  >
                    {`${ccy} nominal`}
                  </text>
                )}
              </svg>
              {hover && (
                <Tooltip
                  group={hover.group}
                  unit={unit}
                  money={ccy}
                  left={hover.px > layout.width / 2 ? layout.width - hover.px + 12 : hover.px + 12}
                  top={Math.max(4, Math.min(hover.py - 10, chartHeight(layout.width) - 130))}
                  flip={hover.px > layout.width / 2}
                />
              )}
              {points.length === 1 && (
                <p class="chart-note muted">Add another row to draw the line.</p>
              )}
            </>
          )}
        </div>
        {layout !== null && (
          <div class="chart-export">
            <button type="button" class="btn" onClick={saveSvg}>
              Download SVG
            </button>
            <button type="button" class="btn" disabled={exportState.busy} onClick={savePng}>
              Download PNG
            </button>
            <span class="muted" data-testid="download-size">
              {sizeLabel({ width: layout.width, height: layout.height })}
            </span>
            {exportState.error && (
              <span class="error" role="alert">
                {exportState.error}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
