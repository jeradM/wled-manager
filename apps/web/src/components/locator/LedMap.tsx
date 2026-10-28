import { memo, useMemo } from "react";
import type { LedLayout, LedMarker, LedRange } from "@wled-manager/shared";

const CELL = 18;
// Rows are taller than columns are wide, leaving room for index labels between rows.
const ROW = CELL * 1.6;

/** Position of every LED (and of its index label) for a layout, in SVG units. */
export function ledPositions(count: number, layout: LedLayout) {
  const order = (i: number) => (layout.reverse ? count - 1 - i : i);
  if (layout.type === "ring") {
    const radius = Math.max(120, (count * CELL) / (2 * Math.PI));
    const labelRadius = radius + CELL * 1.3;
    const size = radius * 2 + CELL * 6;
    const points = Array.from({ length: count }, (_, i) => {
      const a = (order(i) / count) * 2 * Math.PI - Math.PI / 2;
      return {
        x: size / 2 + radius * Math.cos(a),
        y: size / 2 + radius * Math.sin(a),
        labelX: size / 2 + labelRadius * Math.cos(a),
        labelY: size / 2 + labelRadius * Math.sin(a) + 3,
      };
    });
    return { points, width: size, height: size };
  }
  const columns = Math.min(layout.columns, Math.max(count, 1));
  const rows = Math.ceil(count / columns);
  const points = Array.from({ length: count }, (_, i) => {
    const k = order(i);
    const row = Math.floor(k / columns);
    let col = k % columns;
    if (layout.type === "grid" && layout.serpentine && row % 2 === 1) col = columns - 1 - col;
    const x = col * CELL + CELL;
    const y = row * ROW + ROW;
    return { x, y, labelX: x, labelY: y - CELL * 0.55 };
  });
  return { points, width: columns * CELL + CELL, height: rows * ROW + ROW / 2 };
}

/** How a click changes the selection: Shift extends from the last click, Ctrl/Cmd adds or removes. */
export interface SelectMods {
  range: boolean;
  toggle: boolean;
}

interface Props {
  count: number;
  layout: LedLayout;
  markers: LedMarker[];
  /** Named in each LED's tooltip. */
  ranges?: LedRange[];
  /** The LED last clicked or stepped to. */
  current: number | null;
  /** Selected LEDs, drawn lit in `color`. */
  selected?: ReadonlySet<number>;
  color: string;
  /** Per-LED fill, e.g. the segment an LED belongs to; unset LEDs are drawn dark. */
  colors?: (string | undefined)[];
  /** Per-LED ring drawn in place of the marker ring, e.g. palette stops. */
  outlines?: (string | undefined)[];
  /** Per-LED text added to the tooltip. */
  notes?: (string | undefined)[];
  onSelect?: (index: number, mods: SelectMods) => void;
}

/** Clickable map of a controller's LEDs, with markers and the lit LED highlighted. */
export const LedMap = memo(function LedMap({
  count,
  layout,
  markers,
  ranges,
  current,
  selected,
  color,
  colors,
  outlines,
  notes,
  onSelect,
}: Props) {
  const { points, width, height } = useMemo(() => ledPositions(count, layout), [count, layout]);
  const markerAt = useMemo(() => new Map(markers.map((m) => [m.index, m.label])), [markers]);
  const rangesAt = useMemo(() => {
    const at = new Map<number, string[]>();
    for (const r of ranges ?? [])
      for (const s of r.spans) for (let i = s.start; i < s.stop; i++) at.set(i, [...(at.get(i) ?? []), r.label]);
    return at;
  }, [ranges]);
  const labelEvery = count > 400 ? 50 : count > 100 ? 25 : 10;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="max-h-[70vh] w-full select-none"
      aria-label="LEDs"
      // On macOS Ctrl-click opens the context menu; it's a selection click here.
      onContextMenu={(e) => onSelect && e.ctrlKey && e.preventDefault()}
    >
      {points.map((p, i) => {
        const marked = markerAt.has(i);
        const lit = selected ? selected.has(i) : i === current;
        const focused = i === current;
        const names = [markerAt.get(i), ...(rangesAt.get(i) ?? []), notes?.[i]].filter(Boolean);
        const outline = outlines?.[i];
        return (
          <g
            key={i}
            // mousedown rather than click: macOS doesn't send click for Ctrl-click.
            onMouseDown={
              onSelect &&
              ((e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                onSelect(i, { range: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
              })
            }
            className={onSelect ? "cursor-pointer" : ""}
          >
            <title>{`LED ${i}${names.length ? ` · ${names.join(", ")}` : ""}`}</title>
            {/* Larger invisible hit target than the dot itself. */}
            <circle cx={p.x} cy={p.y} r={CELL / 2} fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={lit ? CELL * 0.45 : outline ? CELL * 0.4 : colors?.[i] ? CELL * 0.34 : CELL * 0.28}
              fill={lit ? color : (colors?.[i] ?? "#3f3f46")}
              stroke={focused && lit ? "#ffffff" : (outline ?? (marked ? "#f59e0b" : "none"))}
              strokeWidth={(focused && lit) || outline || marked ? 2 : 0}
              className={lit || !onSelect ? "" : "hover:fill-neutral-400"}
            />
            {i % labelEvery === 0 && (
              <text x={p.labelX} y={p.labelY} textAnchor="middle" fontSize={8} fill="#737373" pointerEvents="none">
                {i}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
