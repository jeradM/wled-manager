import { useRef, type PointerEvent } from "react";
import { stopsToCss, type PaletteStop } from "@wled-manager/shared";

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Color of the gradient at a position, for seeding a newly added stop. */
export function sampleGradient(stops: PaletteStop[], pos: number): string {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const after = sorted.findIndex((s) => s.pos >= pos);
  if (after <= 0) return sorted[after === -1 ? sorted.length - 1 : 0]!.color;
  const a = sorted[after - 1]!;
  const b = sorted[after]!;
  const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
  const [ca, cb] = [hexToRgb(a.color), hexToRgb(b.color)];
  return rgbToHex(ca.map((v, i) => v + (cb[i]! - v) * t));
}

export function GradientSwatch({ stops, className = "h-6" }: { stops: PaletteStop[]; className?: string }) {
  return <div className={`rounded ${className}`} style={{ background: stopsToCss(stops) }} />;
}

interface Props {
  stops: PaletteStop[];
  onChange: (stops: PaletteStop[]) => void;
  selected: number;
  onSelect: (index: number) => void;
  maxStops: number;
}

/** Gradient bar with draggable stop handles. Click empty space on the bar to add a stop. */
export function GradientEditor({ stops, onChange, selected, onSelect, maxStops }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const posFromEvent = (e: PointerEvent) => {
    const rect = bar.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * 255);
  };

  const onBarPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== bar.current || stops.length >= maxStops) return;
    const pos = posFromEvent(e);
    onChange([...stops, { pos, color: sampleGradient(stops, pos) }]);
    onSelect(stops.length);
  };

  const onHandlePointerDown = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = index;
    onSelect(index);
  };

  const onHandlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const index = dragging.current;
    if (index === null) return;
    const pos = posFromEvent(e);
    if (pos !== stops[index]!.pos) onChange(stops.map((s, i) => (i === index ? { ...s, pos } : s)));
  };

  return (
    <div className="select-none pb-6">
      <div
        ref={bar}
        onPointerDown={onBarPointerDown}
        className="relative h-14 cursor-copy rounded-md border border-neutral-700"
        style={{ background: stopsToCss(stops) }}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Stop at ${s.pos}`}
            onPointerDown={(e) => onHandlePointerDown(e, i)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={() => (dragging.current = null)}
            onKeyDown={(e) => {
              const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
              if (!delta) return;
              e.preventDefault();
              const pos = Math.min(255, Math.max(0, s.pos + delta * (e.shiftKey ? 16 : 1)));
              onChange(stops.map((x, j) => (j === i ? { ...x, pos } : x)));
            }}
            className={`absolute top-full -ml-2 mt-1 size-4 cursor-grab rotate-45 rounded-sm border-2 active:cursor-grabbing ${
              i === selected ? "z-10 border-white" : "border-neutral-500"
            }`}
            style={{ left: `${(s.pos / 255) * 100}%`, background: s.color }}
          />
        ))}
      </div>
    </div>
  );
}
