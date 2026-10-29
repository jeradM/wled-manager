import { useEffect, useMemo, useRef, useState } from "react";
import { layoutStrips, type LayerOrigin, type Layout, type LayoutStrip, type Palette, type PresetState, type Segment } from "@wled-manager/shared";
import { Simulator as Sim, ledCss } from "@wled-manager/shared/sim";
import { layoutImageUrl } from "../../queries";
import { LedDetails, applyToSim, usePalette16s, type LayerInfo } from "./LedCanvas";

const stripKey = (s: Pick<LayoutStrip, "controllerId">) => s.controllerId ?? "";

/**
 * Simulated lights where they really are: a layout's picture with each line's lights on it. Every controller
 * on the layout runs its own simulator, as the real controllers would, with the state `stateFor` gives it.
 * While paused, clicking a light explains its color.
 */
export function LayoutView({
  layout,
  stateFor,
  stripName,
  palettes,
  paused,
  whiteLeds,
  layerInfo,
  maxHeight = 0.6,
}: {
  layout: Layout;
  /** The light state a strip runs. Keep it stable (useCallback): a new function re-applies every strip. */
  stateFor: (strip: LayoutStrip) => PresetState;
  /** The strip's controller name, for the light details. */
  stripName: (controllerId: string | null) => string;
  palettes: Palette[];
  paused: boolean;
  whiteLeds: boolean;
  layerInfo?: LayerInfo;
  /** Tallest the view gets, as a fraction of the window's height. */
  maxHeight?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const strips = useMemo(() => layoutStrips(layout), [layout]);
  const resolved = usePalette16s(palettes);
  /** A simulator per strip, kept across edits so effects keep running. */
  const sims = useRef(new Map<string, Sim>());
  const simFor = (s: LayoutStrip) => {
    let sim = sims.current.get(stripKey(s));
    if (!sim) sims.current.set(stripKey(s), (sim = new Sim(Math.max(1, s.ledCount))));
    return sim;
  };
  // What each strip ran, for the light details.
  const ran = useRef(new Map<string, { state: PresetState; layers: { seg: Segment[]; origin: LayerOrigin[] } }>());
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    for (const s of strips) {
      const state = stateFor(s);
      ran.current.set(stripKey(s), { state, layers: applyToSim(simFor(s), state, Math.max(1, s.ledCount), resolved) });
    }
    setApplied((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strips, stateFor, resolved]);

  const [picked, setPicked] = useState<{ strip: string; led: number; x: number; y: number } | null>(null);
  useEffect(() => {
    for (const s of strips) simFor(s).setPaused(paused);
    if (!paused) setPicked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strips, paused]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvailable(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    const resize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // As wide as there's room for, but no taller than most of the window: the view sits in a panel that stays
  // on screen while the page scrolls, so a tall picture would otherwise be cut off at the bottom.
  const aspect = layout.image ? layout.image.height / layout.image.width : 9 / 16;
  const width = Math.max(0, Math.min(available, Math.floor((windowHeight * maxHeight) / aspect)));
  const height = Math.round(width * aspect);
  const radius = layout.ledSize / 2;

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
      ctx.clearRect(0, 0, width, height);
      for (const s of strips) {
        const px = simFor(s).frame(now);
        const state = ran.current.get(stripKey(s))?.state;
        const on = state?.on !== false;
        const bri = state?.bri ?? 128;
        for (const light of s.lights) {
          const c = on ? (px[light.led] ?? 0) : 0;
          const x = light.x * width;
          const y = light.y * height;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          if (c) {
            ctx.fillStyle = ledCss(c, bri, whiteLeds);
            ctx.fill();
          } else {
            ctx.strokeStyle = "rgba(255,255,255,0.25)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (picked && picked.strip === stripKey(s) && picked.led === light.led) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strips, width, height, radius, whiteLeds, picked]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!paused) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { strip: string; led: number; d: number } | null = null;
    for (const s of strips)
      for (const l of s.lights) {
        const d = Math.hypot(l.x * width - x, l.y * height - y);
        if (d <= Math.max(radius, 6) + 2 && (!best || d < best.d)) best = { strip: stripKey(s), led: l.led, d };
      }
    setPicked(best && !(picked?.strip === best.strip && picked.led === best.led) ? { strip: best.strip, led: best.led, x, y } : null);
  };

  const pickedSim = picked ? sims.current.get(picked.strip) : undefined;
  const pickedRan = picked ? ran.current.get(picked.strip) : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => (picked && pickedSim ? pickedSim.explain(picked.led) : null), [picked, pickedSim, applied]);

  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative mx-auto" style={{ width }}>
        <div className="relative overflow-hidden rounded-md bg-neutral-950" style={{ height }}>
          {layout.image && (
            <img src={layoutImageUrl(layout)} alt="" className="absolute inset-0 size-full object-fill brightness-[0.45]" draggable={false} />
          )}
          <canvas
            ref={canvasRef}
            onClick={pick}
            style={{ width: "100%", height }}
            className={`absolute inset-0 ${paused ? "cursor-pointer" : ""}`}
            title={paused ? "Click a light to see how its color is made" : undefined}
          />
        </div>
        {strips.length === 0 && <p className="mt-1 text-xs text-neutral-500">This layout has no lights yet. Draw some in the layout designer.</p>}
        {paused && !picked && strips.length > 0 && <p className="mt-1 text-xs text-neutral-500">Paused. Click a light to see how its color is made.</p>}
        {picked && trace && pickedRan && (
          <div className="absolute z-40 mt-1" style={{ top: picked.y + 12, left: Math.max(0, Math.min(picked.x - 24, width - 384)) }}>
            <LedDetails
              trace={trace}
              state={pickedRan.state}
              layers={pickedRan.layers}
              palettes={palettes}
              whiteLeds={whiteLeds}
              layerInfo={layerInfo ?? ((i, k) => ({ label: pickedRan.state.seg[i]?.layers?.length ? `Layer ${k + 1}` : undefined, hidden: false }))}
              title={`${stripName(picked.strip || null)} · LED ${picked.led}`}
              onClose={() => setPicked(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
