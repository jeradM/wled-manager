import { useEffect, useRef, useState } from "react";
import { lineFirstLeds, linePoints, type LayoutLine, type LayoutPoint } from "@wled-manager/shared";
import { ZoomControls, typing, useZoomPan, type Geo } from "./zoom";

/** Colors telling controllers apart on a layout; lines on no controller are gray. */
const CONTROLLER_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c", "#f87171"];
export const UNASSIGNED_COLOR = "#a3a3a3";
export const controllerColor = (index: number) => (index < 0 ? UNASSIGNED_COLOR : CONTROLLER_COLORS[index % CONTROLLER_COLORS.length]!);

export type LayoutTool = "select" | "draw";

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The point `p` with the line from `anchor` turned to the nearest multiple of 45° (on screen), keeping its
 * length: for drawing straight runs along gutters and corners.
 */
function snap(anchor: LayoutPoint, p: LayoutPoint, w: number, h: number): LayoutPoint {
  const dx = (p.x - anchor.x) * w;
  const dy = (p.y - anchor.y) * h;
  const len = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: clamp(anchor.x + (Math.cos(angle) * len) / w), y: clamp(anchor.y + (Math.sin(angle) * len) / h) };
}

type Drag = { id: string; part: "from" | "to" | "line"; start: LayoutPoint; line: LayoutLine };

/**
 * A layout's picture with its lines drawn over it. With the draw tool, two clicks add a line (first light,
 * then last); with the select tool, lines can be picked and their ends or the whole line dragged. Shift
 * snaps to 45° steps. Without a tool it only shows the layout.
 *
 * With a tool, the picture can be zoomed (pinch, Ctrl/⌘ + scroll, the buttons, or + / − / 0) and panned
 * (scroll, drag empty space with the select tool, or hold Space or the middle button and drag). Lights and
 * handles keep their size on screen, so zooming in spreads dense runs apart.
 */
export function LayoutCanvas({
  lines,
  imageUrl,
  aspect,
  ledSize,
  colorOf,
  tool,
  selected,
  onSelect,
  onChange,
  onDraw,
}: {
  lines: LayoutLine[];
  imageUrl: string | null;
  /** Height over width. */
  aspect: number;
  ledSize: number;
  colorOf: (controllerId: string | null) => string;
  tool?: LayoutTool;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (lines: LayoutLine[]) => void;
  /** A line drawn from its first light to its last; `pixels` is its length with the whole picture in view. */
  onDraw?: (from: LayoutPoint, to: LayoutPoint, pixels: number) => void;
}) {
  const zoomable = !!tool;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  // Editing, the view stays on screen and the picture zooms within it; otherwise it's the picture's shape.
  const height = zoomable ? Math.min(Math.round(width * aspect), Math.round(windowHeight * 0.75)) : Math.round(width * aspect);
  const bw = Math.min(width, height / aspect);
  const geo: Geo = { w: width, h: height, bw, bh: bw * aspect };
  const zoom = useZoomPan(wrapRef, geo, zoomable);
  const { view, cw, ch } = zoom;

  const [pending, setPending] = useState<LayoutPoint | null>(null);
  const [hover, setHover] = useState<LayoutPoint | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [space, setSpace] = useState(false);
  const over = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    const resize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    if (tool !== "draw") setPending(null);
  }, [tool]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
      if (zoomable && e.key === " " && over.current && !typing(e.target)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.key === " " && setSpace(false);
    const blur = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomable]);

  const point = (e: React.PointerEvent | React.MouseEvent): LayoutPoint => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left - view.ox) / cw), y: clamp((e.clientY - r.top - view.oy) / ch) };
  };
  const px = (p: LayoutPoint) => ({ x: view.ox + p.x * cw, y: view.oy + p.y * ch });
  const firsts = lineFirstLeds(lines);
  /** Pans instead of editing: the middle button, Space held, or empty space with the select tool. */
  const pans = (e: React.PointerEvent, background: boolean) => zoomable && (e.button === 1 || space || (background && tool === "select" && e.button === 0));

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (pans(e, true)) return zoom.startPan(e);
    if (tool !== "draw" || e.button !== 0) return;
    let p = point(e);
    if (!pending) return setPending(p);
    if (e.shiftKey) p = snap(pending, p, cw, ch);
    const pixels = Math.hypot((p.x - pending.x) * geo.bw, (p.y - pending.y) * geo.bh);
    setPending(null);
    if (pixels * view.z >= 4) onDraw?.(pending, p, pixels);
  };
  const onMove = (e: React.PointerEvent) => {
    if (zoom.movePan(e)) return;
    const p = point(e);
    setHover(pending && e.shiftKey ? snap(pending, p, cw, ch) : p);
    if (!drag) return;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const l = drag.line;
    let next: LayoutLine;
    if (drag.part === "line") {
      // Keep the whole line on the picture.
      const mx = Math.min(Math.max(dx, -Math.min(l.from.x, l.to.x)), 1 - Math.max(l.from.x, l.to.x));
      const my = Math.min(Math.max(dy, -Math.min(l.from.y, l.to.y)), 1 - Math.max(l.from.y, l.to.y));
      next = { ...l, from: { x: l.from.x + mx, y: l.from.y + my }, to: { x: l.to.x + mx, y: l.to.y + my } };
    } else {
      const other = drag.part === "from" ? l.to : l.from;
      const moved = e.shiftKey ? snap(other, p, cw, ch) : p;
      next = { ...l, [drag.part]: moved };
    }
    onChange?.(lines.map((x) => (x.id === l.id ? next : x)));
  };
  const onUp = () => {
    // A click on empty space (not a pan) clears the selection.
    if (zoom.endPan() === "click" && tool === "select") onSelect?.(null);
    setDrag(null);
  };
  const startDrag = (e: React.PointerEvent, l: LayoutLine, part: Drag["part"]) => {
    if (tool !== "select" || e.button !== 0 || pans(e, false)) return; // panning: let the background have it
    e.stopPropagation();
    onSelect?.(l.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: l.id, part, start: point(e), line: l });
  };

  const r = ledSize / 2;
  const cursor = zoom.panning ? "cursor-grabbing" : space ? "cursor-grab" : tool === "draw" ? "cursor-crosshair" : "";
  return (
    <div ref={wrapRef} className={`relative w-full overflow-hidden rounded-md bg-neutral-950 select-none ${cursor}`} style={{ height }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="absolute max-w-none object-fill brightness-75"
          style={{ left: view.ox, top: view.oy, width: cw, height: ch }}
          draggable={false}
        />
      )}
      {!imageUrl && tool && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-600">Choose a picture, or draw on the blank canvas.</p>
      )}
      <svg
        width={width}
        height={height}
        className="absolute inset-0"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerEnter={() => (over.current = true)}
        onPointerLeave={() => {
          over.current = false;
          setHover(null);
        }}
        onAuxClick={(e) => e.preventDefault()}
      >
        {!imageUrl && zoomable && view.z > 1 && <rect x={view.ox} y={view.oy} width={cw} height={ch} fill="none" stroke="#404040" />}
        {lines.map((l, i) => {
          const color = colorOf(l.controllerId);
          const a = px(l.from);
          const b = px(l.to);
          const isSel = l.id === selected;
          const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={l.id} opacity={selected && !isSel ? 0.75 : 1}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={isSel ? 2 : 1.25}
                strokeDasharray={l.count === 0 ? "6 5" : undefined}
                opacity={l.count === 0 ? 0.9 : 0.6}
              />
              {linePoints(l).map((p, k) => {
                const q = px(p);
                return <circle key={k} cx={q.x} cy={q.y} r={r} fill={color} stroke={k === 0 ? "white" : "none"} strokeWidth={k === 0 ? 1.5 : 0} />;
              })}
              {/* Direction: from the first light towards the last. */}
              <path d="M -5 -4 L 4 0 L -5 4 Z" fill="white" transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`} opacity={0.9} />
              {l.count > 0 && (
                <text x={a.x + 6} y={a.y - 6} fontSize={10} fill="white" stroke="black" strokeWidth={2.5} paintOrder="stroke">
                  {firsts[i]}
                </text>
              )}
              {tool === "select" && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={Math.max(14, ledSize + 6)}
                  className={space || zoom.panning ? "" : "cursor-move"}
                  onPointerDown={(e) => startDrag(e, l, "line")}
                />
              )}
            </g>
          );
        })}
        {/* Line ends on top of every line, so an end can be grabbed where lines meet; the selected line's last. */}
        {tool === "select" &&
          [...lines.filter((l) => l.id !== selected), ...lines.filter((l) => l.id === selected)].map((l) =>
            (["from", "to"] as const).map((part) => {
              const q = px(l[part]);
              const isSel = l.id === selected;
              return (
                <circle
                  key={`${l.id}-${part}`}
                  cx={q.x}
                  cy={q.y}
                  r={Math.max(7, r + 3)}
                  fill="transparent"
                  stroke="white"
                  strokeWidth={2}
                  strokeDasharray={part === "to" ? "3 2" : undefined}
                  className={`${isSel ? "" : "opacity-0 hover:opacity-100"} ${space || zoom.panning ? "" : "cursor-grab"}`}
                  onPointerDown={(e) => startDrag(e, l, part)}
                >
                  <title>{part === "from" ? "First light: drag to move this end" : "Last light: drag to move this end"}</title>
                </circle>
              );
            }),
          )}
        {pending && (
          <>
            <circle cx={px(pending).x} cy={px(pending).y} r={4} fill="white" />
            {hover && <line x1={px(pending).x} y1={px(pending).y} x2={px(hover).x} y2={px(hover).y} stroke="white" strokeWidth={1.5} strokeDasharray="4 3" />}
          </>
        )}
      </svg>
      {zoomable && (
        <ZoomControls
          zoom={zoom}
          title={`Zoom: pinch, Ctrl/⌘ + scroll, or + / − / 0. Pan: scroll, ${tool === "select" ? "drag empty space, " : ""}or hold Space or the middle button and drag.`}
        />
      )}
    </div>
  );
}
