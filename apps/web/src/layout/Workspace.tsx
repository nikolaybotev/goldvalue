import { useEffect, useRef, useState } from "preact/hooks";
import { Chart } from "../chart/Chart";
import { Sheet } from "../sheet/Sheet";
import { SPLIT_MAX, SPLIT_MIN, settings, updateSettings } from "../store/sheet-store";

const WIDE = "(min-width: 900px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

const clamp = (value: number) => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, value));

/** Draggable and keyboard-operable divider (ARIA window splitter). */
function Splitter({
  percent,
  onChange,
  onCommit,
  container,
}: {
  percent: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  container: { current: HTMLDivElement | null };
}) {
  const dragging = useRef(false);
  const latest = useRef(percent);
  latest.current = percent;

  const fromPointer = (event: PointerEvent) => {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.width === 0) return latest.current;
    return clamp(((event.clientX - box.left) / box.width) * 100);
  };

  return (
    <hr
      class="splitter"
      aria-orientation="vertical"
      aria-label="Resize sheet and chart"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`Sheet ${Math.round(percent)} percent wide`}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (dragging.current) onChange(fromPointer(event));
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        onCommit(fromPointer(event));
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        let next: number | null = null;
        if (event.key === "ArrowLeft") next = percent - step;
        else if (event.key === "ArrowRight") next = percent + step;
        else if (event.key === "Home") next = SPLIT_MIN;
        else if (event.key === "End") next = SPLIT_MAX;
        if (next === null) return;
        event.preventDefault();
        onCommit(clamp(next));
      }}
    />
  );
}

/** Wide (>= 900 px): sheet left, chart right, resizable divider. Narrow: stacked, chart collapsible. */
export function Workspace() {
  const wide = useWide();
  const saved = settings.value.splitPercent;
  const [drag, setDrag] = useState<number | null>(null);
  const percent = drag ?? saved;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      class="workspace"
      ref={ref}
      style={
        wide
          ? { gridTemplateColumns: `minmax(0, ${percent}fr) 12px minmax(0, ${100 - percent}fr)` }
          : undefined
      }
      data-layout={wide ? "wide" : "narrow"}
    >
      <Sheet />
      {wide && (
        <Splitter
          percent={percent}
          container={ref}
          onChange={setDrag}
          onCommit={(value) => {
            setDrag(null);
            updateSettings({ splitPercent: value });
          }}
        />
      )}
      <Chart collapsible={!wide} />
    </div>
  );
}
