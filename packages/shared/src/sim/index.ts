/**
 * Browser WLED simulator: a port of WLED main's 1D effect engine (FX.cpp / FX_fcn.cpp / colors.cpp).
 * Effects render into each segment's own buffer; show() blends segments into the strip with grouping,
 * spacing, reverse, mirror, offset, opacity and blend mode, as WLED 0.16 does.
 */
import { stopsToWled } from "../palette.js";
import type { PaletteStop, PresetState, Segment as PresetSegment, WledColor } from "../schemas.js";
import { RGBW32, R, G, B, W, gradientPalette, type Palette16 } from "./color.js";
import { basicEffects } from "./effects/basic.js";
import { classicEffects } from "./effects/classic.js";
import { extraEffects } from "./effects/extra.js";
import { moreEffects } from "./effects/more.js";
import { FX_METADATA } from "./fxdata.js";
import { PALETTE_NAMES } from "./palettes.js";
import { DEFAULT_C1, DEFAULT_C2, DEFAULT_C3, DEFAULT_INTENSITY, DEFAULT_SPEED, Segment, Strip, type EffectFn, type LedTrace } from "./segment.js";

export { Segment, Strip, BLEND_MODE_COUNT, segblend } from "./segment.js";
export type { LayerTrace, LedTrace, PixelWrite } from "./segment.js";
export type { Palette16 } from "./color.js";
export { PALETTE_NAMES } from "./palettes.js";

export const SIM_EFFECTS = new Map<number, EffectFn>(
  Object.entries({ ...basicEffects, ...classicEffects, ...moreEffects, ...extraEffects }).map(([id, fn]) => [Number(id), fn]),
);

/** Effect name and metadata, indexed by ID like a controller's /json/eff and /json/fxdata. Unsimulated IDs are "". */
export function simCatalog(): { effects: string[]; fxdata: string[]; palettes: string[] } {
  const max = Math.max(...SIM_EFFECTS.keys());
  const effects: string[] = [];
  const fxdata: string[] = [];
  for (let id = 0; id <= max; id++) {
    const meta = SIM_EFFECTS.has(id) ? FX_METADATA[id] : undefined;
    const at = meta?.indexOf("@") ?? -1;
    effects.push(meta === undefined ? "" : at < 0 ? meta : meta.slice(0, at));
    fxdata.push(meta === undefined || at < 0 ? "" : meta.slice(at + 1));
  }
  return { effects, fxdata, palettes: [...PALETTE_NAMES] };
}

export interface EffectDefaults {
  sx: number;
  ix: number;
  c1: number;
  c2: number;
  c3: number;
  o1: boolean;
  o2: boolean;
  o3: boolean;
  pal: number;
}

/** Slider defaults from the metadata's 5th field, e.g. "sx=24,pal=50"; WLED loads these when the effect is picked. */
export function effectDefaults(fx: number): EffectDefaults {
  const d: EffectDefaults = { sx: DEFAULT_SPEED, ix: DEFAULT_INTENSITY, c1: DEFAULT_C1, c2: DEFAULT_C2, c3: DEFAULT_C3, o1: false, o2: false, o3: false, pal: 0 };
  const fields = (FX_METADATA[fx] ?? "").split("@")[1]?.split(";")[4] ?? "";
  for (const kv of fields.split(",")) {
    const [k, v] = kv.split("=");
    const n = Number(v);
    if (!k || v === undefined || Number.isNaN(n)) continue;
    if (k === "o1" || k === "o2" || k === "o3") d[k] = n !== 0;
    else if (k in d) (d as unknown as Record<string, number>)[k] = n;
  }
  return d;
}

/** A library palette as the controller loads its /paletteN.json file (WLED's loadCustomPalettes). */
export function stopsToPalette16(stops: PaletteStop[]): Palette16 {
  const flat = stopsToWled(stops).palette as number[];
  const tcp = new Uint8Array(72).fill(255);
  for (let i = 0, j = 0; i + 3 < flat.length && j < 72; i += 4, j += 4) {
    const pos = flat[i]!;
    tcp[j] = pos;
    tcp[j + 1] = flat[i + 1]!;
    tcp[j + 2] = flat[i + 2]!;
    tcp[j + 3] = flat[i + 3]!;
    if (pos >= 255) break;
  }
  return gradientPalette(tcp);
}

/** WLED color ([r,g,b], [r,g,b,w] or "rrggbb[ww]") -> packed WRGB. */
export function wledColorToInt(c: WledColor | undefined): number {
  if (c === undefined) return 0;
  if (typeof c === "string") {
    const n = parseInt(c.replace(/^#/, "").padEnd(6, "0"), 16) || 0;
    return c.replace(/^#/, "").length >= 8 ? RGBW32((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255) : n & 0xffffff;
  }
  return RGBW32(c[0], c[1], c[2], c[3] ?? 0);
}

/** Library palettes by ID, resolved to the 16-entry palettes effects use. */
export type PaletteResolver = (paletteId: string) => Palette16 | null;

/** WLED's default segment colors (orange, black, black). */
const DEFAULT_COLORS: [number, number, number] = [0xffaa00, 0, 0];

/**
 * Runs a preset's light state on `length` simulated LEDs. Call apply() whenever the state changes and
 * frame() on each animation frame; effects keep running state between apply() calls, as on the
 * controller, and restart only when the effect or the segment's geometry changes.
 */
export class Simulator {
  readonly strip: Strip;
  private started: number | null = null;
  private lastFrame = 0;
  private lastService = -Infinity;
  private paused = false;
  /** Position in the applied state.seg of each strip segment (segments with stop 0 aren't simulated). */
  private positions: number[] = [];

  constructor(length: number) {
    this.strip = new Strip(length, SIM_EFFECTS);
  }

  get length() {
    return this.strip.length;
  }

  setLength(n: number) {
    if (n === this.strip.length) return;
    this.strip.setLength(n);
    for (const s of this.strip.segments) s.markForReset();
  }

  apply(state: PresetState, palettes: PaletteResolver) {
    const strip = this.strip;
    strip.brightness = state.bri ?? 128;
    if (state.transition !== undefined) strip.transition = state.transition * 100;
    const positions = state.seg.flatMap((s, p) => ((s.stop ?? 1) !== 0 ? [p] : []));
    const segs = positions.map((p) => state.seg[p]!);
    this.positions = positions;
    const next: Segment[] = [];
    segs.forEach((ps, i) => {
      const start = Math.min(ps.start ?? 0, strip.length);
      const stop = Math.min(ps.stop ?? strip.length, strip.length);
      const prev = strip.segments[i];
      const seg = prev ?? new Segment(strip, start, stop);
      if (prev && (prev.start !== start || prev.stop !== stop)) seg.setGeometry(start, stop);
      configure(seg, ps, palettes);
      next.push(seg);
    });
    strip.segments = next;
    // While paused, show edits (blend mode, opacity, geometry) on the frozen frame.
    if (this.paused) strip.show();
  }

  /**
   * Advances to `now` (performance.now() or similar) and returns the LED colors. Like WLED, effects run
   * at most once per frame time (42 fps), so effects that step once per call keep the controller's pace.
   */
  frame(now: number): Uint32Array {
    if (this.started === null) this.started = now - this.strip.frametime;
    if (this.paused) this.started += now - this.lastFrame;
    this.lastFrame = now;
    const t = Math.max(0, Math.round(now - this.started));
    if (!this.paused && (this.strip.segments.some((s) => s.reset) || t - this.lastService >= this.strip.frametime)) {
      this.lastService = t;
      this.strip.service(t);
    }
    return this.strip.pixels;
  }

  /** How an LED got its color in the current frame; layer `segment`s are positions in the applied state.seg. */
  explain(led: number): LedTrace {
    const t = this.strip.explain(led);
    return { ...t, layers: t.layers.map((l) => ({ ...l, segment: this.positions[l.segment] ?? l.segment })) };
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Restarts every effect from its first frame. */
  restart() {
    for (const s of this.strip.segments) s.markForReset();
  }
}

function configure(seg: Segment, ps: PresetSegment, palettes: PaletteResolver) {
  const fx = ps.fx ?? 0;
  const d = effectDefaults(fx);
  if (seg.mode !== fx) seg.markForReset();
  seg.mode = SIM_EFFECTS.has(fx) ? fx : 0;
  seg.defaultPalette = d.pal > 0 ? d.pal : 6;
  seg.speed = ps.sx ?? d.sx;
  seg.intensity = ps.ix ?? d.ix;
  seg.custom1 = ps.c1 ?? d.c1;
  seg.custom2 = ps.c2 ?? d.c2;
  seg.custom3 = ps.c3 ?? d.c3;
  seg.check1 = ps.o1 ?? d.o1;
  seg.check2 = ps.o2 ?? d.o2;
  seg.check3 = ps.o3 ?? d.o3;
  seg.on = ps.on ?? true;
  seg.opacity = ps.bri ?? 255;
  seg.blendMode = ps.bm ?? 0;
  const grouping = Math.max(1, ps.grp ?? 1);
  const spacing = ps.spc ?? 0;
  const reverse = ps.rev === true;
  const mirror = ps.mi === true;
  if (grouping !== seg.grouping || spacing !== seg.spacing || mirror !== seg.mirror) seg.markForReset();
  seg.grouping = grouping;
  seg.spacing = spacing;
  seg.reverse = reverse;
  seg.mirror = mirror;
  seg.offset = seg.length ? (ps.of ?? 0) % seg.length : 0;
  seg.freeze = ps.frz === true;
  for (let i = 0; i < 3; i++) seg.colors[i] = ps.col?.[i] === undefined ? DEFAULT_COLORS[i]! : wledColorToInt(ps.col[i]);
  const pal = ps.pal ?? d.pal;
  if (typeof pal === "object") {
    seg.customPalette = palettes(pal.paletteId);
    seg.palette = seg.customPalette ? 255 : 0;
  } else {
    seg.customPalette = null;
    seg.palette = pal;
  }
}

/**
 * CSS color for an LED as it looks lit: the frame buffer holds pre-gamma values, so a monitor (which
 * applies its own ~2.2 gamma) shows them right once scaled by brightness in linear light.
 * White LEDs add to all three channels; RGB-only strips drop the white channel, as WLED does.
 */
export function ledCss(c: number, bri: number, whiteLeds = true): string {
  const k = Math.pow(bri / 255, 1 / 2.2);
  const w = whiteLeds ? W(c) : 0;
  const ch = (v: number) => Math.min(255, Math.round((v + w) * k));
  return `rgb(${ch(R(c))},${ch(G(c))},${ch(B(c))})`;
}
