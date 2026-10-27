import { memo, useMemo } from "react";
import type { LedLayout, LedMarker } from "@wled-manager/shared";

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

interface Props {
  count: number;
  layout: LedLayout;
  markers: LedMarker[];
  current: number | null;
  color: string;
  /** Per-LED fill, e.g. the segment an LED belongs to; unset LEDs are drawn dark. */
  colors?: (string | undefined)[];
  onSelect?: (index: number) => void;
}

/** Clickable map of a controller's LEDs, with markers and the lit LED highlighted. */
export const LedMap = memo(function LedMap({ count, layout, markers, current, color, colors, onSelect }: Props) {
  const { points, width, height } = useMemo(() => ledPositions(count, layout), [count, layout]);
  const markerAt = useMemo(() => new Map(markers.map((m) => [m.index, m.label])), [markers]);
  const labelEvery = count > 400 ? 50 : count > 100 ? 25 : 10;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="max-h-[70vh] w-full select-none" aria-label="LEDs">
      {points.map((p, i) => {
        const marked = markerAt.has(i);
        const lit = i === current;
        return (
          <g key={i} onClick={onSelect && (() => onSelect(i))} className={onSelect ? "cursor-pointer" : ""}>
            <title>{`LED ${i}${marked ? ` · ${markerAt.get(i)}` : ""}`}</title>
            {/* Larger invisible hit target than the dot itself. */}
            <circle cx={p.x} cy={p.y} r={CELL / 2} fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={lit ? CELL * 0.45 : colors?.[i] ? CELL * 0.34 : CELL * 0.28}
              fill={lit ? color : (colors?.[i] ?? "#3f3f46")}
              stroke={marked ? "#f59e0b" : lit ? "#ffffff" : "none"}
              strokeWidth={marked || lit ? 2 : 0}
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
