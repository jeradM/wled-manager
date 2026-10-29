import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { expandLayers, type LayerOrigin, type Palette, type PresetState, type Segment } from "@wled-manager/shared";
import { Simulator as Sim, ledCss, simCatalog, stopsToPalette16, type LedTrace, type Palette16 } from "@wled-manager/shared/sim";
import { BLEND_MODES } from "../preset/wled-options";

/** Effect and palette names the simulator knows, indexed like a controller's lists. */
export const CATALOG = simCatalog();

export const segmentName = (s: Segment, i: number) => (typeof s.n === "string" && s.n ? s.n : `Segment ${s.id ?? i}`);

/** Simulator-only "show" switches: "3" hides segment 3, "3.1" its layer 1 (0 = bottom). */
export type Hidden = Set<string>;
export const isHidden = (hidden: Hidden, i: number, k: number) => hidden.has(`${i}`) || hidden.has(`${i}.${k}`);

/** The segment's effect in the simulator: matched by the name saved with the preset, else by ID. */
export function simEffect(s: Segment): number | undefined {
  const byName = s.fxName ? CATALOG.effects.indexOf(s.fxName) : -1;
  return byName >= 0 ? byName : s.fx;
}

const NONE_HIDDEN: Hidden = new Set();

/** How the LED details name a segment's layer, and whether the simulator hides it. */
export type LayerInfo = (segment: number, layer: number) => { label?: string; hidden: boolean };

/** Library palettes as the simulator uses them, by palette ID. */
export function usePalette16s(palettes: Palette[]) {
  return useMemo(() => {
    const m = new Map<string, Palette16>();
    for (const p of palettes) m.set(p.id, stopsToPalette16(p.stops));
    return m;
  }, [palettes]);
}

/**
 * Runs a light state on a simulator: each layer as a WLED segment of its own on its segment's LEDs, effects
 * matched by name. Returns the WLED segments it ran and where each came from.
 */
export function applyToSim(sim: Sim, state: PresetState, count: number, palettes: Map<string, Palette16>) {
  const expanded = expandLayers(state.seg);
  sim.setLength(count);
  const seg = expanded.seg.map((s) => {
    const fx = simEffect(s);
    return fx === s.fx ? s : { ...s, fx };
  });
  sim.apply({ ...state, seg }, (id) => palettes.get(id) ?? null);
  return expanded;
}

/** The simulated strip: LEDs as circles, wrapped into rows, animated at WLED's frame rate. While paused, clicking an LED explains its color. */
export function LedCanvas({
  state,
  count,
  palettes,
  paused,
  whiteLeds,
  hidden = NONE_HIDDEN,
  layerInfo,
}: {
  state: PresetState;
  count: number;
  palettes: Palette[];
  paused: boolean;
  whiteLeds: boolean;
  /** Segments and layers turned off in the simulator only. */
  hidden?: Hidden;
  /** How the LED details name segment i's layer j, and whether it's hidden; by default from `hidden` and the layer's number. */
  layerInfo?: LayerInfo;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sim = useMemo(() => new Sim(count), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ led: number; x: number; y: number } | null>(null);
  const pickedLed = useRef<number | null>(null);
  pickedLed.current = picked?.led ?? null;

  const resolved = usePalette16s(palettes);

  useEffect(() => {
    sim.setPaused(paused);
    if (!paused) setPicked(null);
  }, [sim, paused]);

  // Bumped after each apply so the details recompute against the current settings.
  const [applied, setApplied] = useState(0);
  const [expanded, setExpanded] = useState(() => expandLayers(state.seg));
  useEffect(() => {
    setExpanded(applyToSim(sim, state, count, resolved));
    setApplied((n) => n + 1);
  }, [sim, state, count, resolved]);

  useEffect(() => {
    if (picked && picked.led >= count) setPicked(null);
  }, [picked, count]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pitch between LED centers: as large as fits on one row, between 10 and 28 px, wrapping into rows.
  const pitch = Math.max(10, Math.min(28, width / count));
  // Rounding can leave width / pitch a hair under a whole number; don't lose a column to it.
  const cols = Math.max(1, Math.floor(width / pitch + 1e-6));
  const rows = Math.ceil(count / cols);
  const height = Math.ceil(rows * pitch);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    let raf = 0;
    const draw = (now: number) => {
      const px = sim.frame(now);
      const on = state.on !== false;
      const bri = state.bri ?? 128;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, width, height);
      const r = pitch * 0.36;
      for (let i = 0; i < count; i++) {
        const x = (i % cols) * pitch + pitch / 2;
        const y = Math.floor(i / cols) * pitch + pitch / 2;
        const c = on ? px[i]! : 0;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = c ? ledCss(c, bri, whiteLeds) : "#1c1c1c";
        ctx.fill();
        if (i === pickedLed.current) {
          ctx.beginPath();
          ctx.arc(x, y, pitch * 0.48, 0, Math.PI * 2);
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim, width, height, pitch, cols, count, state.on, state.bri, whiteLeds]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!paused) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / pitch);
    const led = Math.floor(y / pitch) * cols + col;
    setPicked(col < cols && led < count && led !== picked?.led ? { led, x, y: (Math.floor(y / pitch) + 1) * pitch } : null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => (picked ? sim.explain(picked.led) : null), [sim, picked, applied]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        onClick={pick}
        style={{ width: "100%", height }}
        className={`block rounded-md ${paused ? "cursor-pointer" : ""}`}
        title={paused ? "Click an LED to see how its color is made" : undefined}
      />
      {paused && !picked && <p className="mt-1 text-xs text-neutral-500">Paused. Click an LED to see how its color is made.</p>}
      {picked && trace && (
        <div className="absolute z-40 mt-1" style={{ top: picked.y, left: Math.max(0, Math.min(picked.x - 24, width - 384)) }}>
          <LedDetails
            trace={trace}
            state={state}
            layers={expanded}
            palettes={palettes}
            whiteLeds={whiteLeds}
            layerInfo={
              layerInfo ??
              ((i, k) => ({ label: state.seg[i]?.layers?.length ? `Layer ${k + 1}` : undefined, hidden: isHidden(hidden, i, k) }))
            }
            onClose={() => setPicked(null)}
          />
        </div>
      )}
    </div>
  );
}

const colorText = (c: number, whiteLeds: boolean) => {
  const hex = "#" + (c & 0xffffff).toString(16).padStart(6, "0");
  return whiteLeds && c >>> 24 ? `${hex} W${c >>> 24}` : hex;
};

function Chip({ color, whiteLeds, label }: { color: number; whiteLeds: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={label}>
      <span className="inline-block size-3.5 rounded-full border border-neutral-600" style={{ background: ledCss(color, 255, whiteLeds) }} />
      <span className="font-mono text-[11px] text-neutral-300">{colorText(color, whiteLeds)}</span>
    </span>
  );
}

/** Every segment and layer on an LED, bottom to top, and how each one's color combined with what was below. */
export function LedDetails({
  trace,
  state,
  layers,
  palettes,
  whiteLeds,
  layerInfo,
  title,
  onClose,
}: {
  trace: LedTrace;
  state: PresetState;
  /** The WLED segments the simulator ran (one per layer), and where each came from. */
  layers: { seg: Segment[]; origin: LayerOrigin[] };
  palettes: Palette[];
  whiteLeds: boolean;
  layerInfo: LayerInfo;
  /** Heading; defaults to "LED <number>". */
  title?: string;
  onClose: () => void;
}) {
  const paletteName = (s: Segment) => {
    if (s.pal === undefined) return "effect's default palette";
    if (typeof s.pal === "object") return palettes.find((p) => p.id === (s.pal as { paletteId: string }).paletteId)?.name ?? "deleted palette";
    return CATALOG.palettes[s.pal] ?? `palette ${s.pal}`;
  };
  const effectName = (s: Segment) => {
    const fx = simEffect(s);
    return (fx !== undefined && CATALOG.effects[fx]) || s.fxName || "Solid";
  };
  const on = state.on !== false;
  const bri = state.bri ?? 128;

  return (
    <div className="w-96 space-y-2 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs shadow-xl shadow-black/70">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title ?? `LED ${trace.led}`}
          <Chip color={trace.color} whiteLeds={whiteLeds} />
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-neutral-100">
          ✕
        </button>
      </div>

      {trace.layers.length === 0 && <p className="text-neutral-400">No segment covers this LED, so it stays off.</p>}
      {trace.layers.length > 0 && <p className="text-neutral-500">Segments and their layers are blended bottom to top, starting from black.</p>}

      <ol className="space-y-2">
        {trace.layers.map((layer, n) => {
          const seg = layers.seg[layer.segment]!;
          const { segment: i, layer: k } = layers.origin[layer.segment]!;
          const parent = state.seg[i]!;
          const info = layerInfo(i, k);
          const pct = Math.round(((seg.bri ?? 255) / 255) * 100);
          return (
            <li key={n} className="rounded-md border border-neutral-800 p-2">
              <div className="mb-1 font-medium text-neutral-200">
                {segmentName(parent, i)}
                {info.label ? ` · ${info.label}` : ""}
                <span className="font-normal text-neutral-400">
                  {" "}
                  · {effectName(seg)} · {paletteName(seg)}
                </span>
              </div>
              {layer.status === "off" && (
                <p className="text-neutral-500">Off{info.hidden ? " (hidden in the simulator)" : ""}, so it adds nothing.</p>
              )}
              {layer.status === "gap" && (
                <p className="text-neutral-500">This LED is in the segment's spacing gap, so the segment leaves it alone.</p>
              )}
              {layer.writes.map((w, k) => (
                <div key={k} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                    Effect drew pixel {w.pixel}: <Chip color={w.color} whiteLeds={whiteLeds} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                    <span className="text-neutral-200">{BLEND_MODES[w.mode] ?? `Mode ${w.mode}`}</span>
                    <Chip color={w.below} whiteLeds={whiteLeds} label="Below" />
                    <span>with</span>
                    <Chip color={w.color} whiteLeds={whiteLeds} label={info.label ? "This layer" : "This segment"} />
                    <span>→</span>
                    <Chip color={w.blended} whiteLeds={whiteLeds} label="Blended" />
                  </div>
                  {w.opacity < 255 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                      Opacity {pct}%: mixed with below → <Chip color={w.result} whiteLeds={whiteLeds} />
                    </div>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 pt-2 text-neutral-400">
        {on ? (
          <>
            Brightness {bri} → shown as
            <span className="inline-block size-3.5 rounded-full border border-neutral-600" style={{ background: ledCss(trace.color, bri, whiteLeds) }} />
          </>
        ) : (
          "The light is turned off, so the LED is dark."
        )}
      </div>
      <Link to="/simulator/blend-modes" className="block text-sky-400 hover:text-sky-300">
        How blend modes work
      </Link>
    </div>
  );
}
