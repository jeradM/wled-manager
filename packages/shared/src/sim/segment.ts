/**
 * WLED's segment and strip runtime (FX.h / FX_fcn.cpp) for 1D strips: each segment renders its effect into its own
 * buffer of virtual pixels, then the strip blends segments into the frame with grouping, spacing, mirroring,
 * reversing, offset, opacity and blend mode, as WLED 0.16 does.
 */
import {
  BLACK,
  B,
  CHSV,
  ColorFromPalette,
  G,
  LINEARBLEND,
  LINEARBLEND_NOWRAP,
  NOBLEND,
  R,
  RGBW32,
  W,
  color_add,
  color_blend,
  color_fade,
  fast_color_scale,
  gamma8inv,
  generateRandomPalette,
  gradientPalette,
  hsv2rgb_rainbow,
  nblendPaletteTowardPalette,
  palette16,
  rgb2hsv,
  type Palette16,
} from "./color.js";
import { clock, hw_random8 } from "./math.js";
import { FASTLED_PALETTES, GRADIENT_PALETTES } from "./palettes.js";

export const DEFAULT_SPEED = 128;
export const DEFAULT_INTENSITY = 128;
export const DEFAULT_C1 = 128;
export const DEFAULT_C2 = 128;
export const DEFAULT_C3 = 16;
export const WLED_FPS = 42;
export const FRAMETIME_FIXED = Math.trunc(1000 / WLED_FPS);
export const DYNAMIC_PALETTE_COUNT = 6;
export const FASTLED_PALETTE_COUNT = FASTLED_PALETTES.length;
export const FIXED_PALETTE_COUNT = DYNAMIC_PALETTE_COUNT + FASTLED_PALETTE_COUNT + GRADIENT_PALETTES.length;

const builtinGradients = GRADIENT_PALETTES.map((g) => gradientPalette(g));
const fastled = FASTLED_PALETTES.map((p) => palette16(...p));
const PARTY = fastled[0]!;

export type EffectFn = (s: Segment) => void;

export class Segment {
  colors: [number, number, number] = [0xffa000, 0, 0];
  start: number;
  stop: number;
  offset = 0;
  grouping = 1;
  spacing = 0;
  reverse = false;
  mirror = false;
  on = true;
  freeze = false;
  opacity = 255;
  mode = 0;
  palette = 0;
  /** A library palette for this segment, used instead of `palette`. */
  customPalette: Palette16 | null = null;
  speed = DEFAULT_SPEED;
  intensity = DEFAULT_INTENSITY;
  custom1 = DEFAULT_C1;
  custom2 = DEFAULT_C2;
  custom3 = DEFAULT_C3;
  check1 = false;
  check2 = false;
  check3 = false;
  blendMode = 0;
  /** Palette used when "Default" (0) is chosen; set from the effect's metadata. */
  defaultPalette = 6;

  // runtime data, with C integer widths
  private _step = 0;
  private _call = 0;
  private _aux0 = 0;
  private _aux1 = 0;
  get step() { return this._step; }
  set step(v: number) { this._step = v >>> 0; }
  get call() { return this._call; }
  set call(v: number) { this._call = v >>> 0; }
  get aux0() { return this._aux0; }
  set aux0(v: number) { this._aux0 = v & 0xffff; }
  get aux1() { return this._aux1; }
  set aux1(v: number) { this._aux1 = v & 0xffff; }
  /** SEGENV.data: effect state bytes. */
  data = new Uint8Array(0);
  /** Typed state for effects that keep structs in their data buffer; cleared with it on reset. */
  state: any = null;
  reset = true;
  pixels: Uint32Array;

  /** Draw parameters for the current frame (WLED's static _currentColors/_currentPalette). */
  currentColors: [number, number, number] = [0, 0, 0];
  currentPalette: Palette16 = new Uint32Array(16);

  constructor(public strip: Strip, start: number, stop: number) {
    this.start = start;
    this.stop = Math.max(stop, start + 1);
    this.pixels = new Uint32Array(this.length);
  }

  get length() { return this.stop > this.start ? this.stop - this.start : 0; }
  get groupLength() { return this.grouping + this.spacing; }
  get isActive() { return this.stop > this.start; }
  /** SEGLEN: virtual length after grouping, spacing and mirroring. */
  get vLength() {
    const g = Math.max(1, this.groupLength);
    let v = Math.trunc((this.length + g - 1) / g);
    if (this.mirror) v = (v + 1) >> 1;
    return v;
  }
  get now() { return this.strip.now; }
  get frametime() { return this.strip.frametime; }
  get speedFormulaL() { return 5 + Math.trunc((50 * (255 - this.speed)) / this.vLength); }
  get dataSize() { return this.data.length; }
  is2D() { return false; }
  nrOfVStrips() { return 1; }

  setGeometry(start: number, stop: number) {
    this.start = start;
    this.stop = stop;
    if (this.pixels.length !== this.length) this.pixels = new Uint32Array(this.length);
    this.reset = true;
  }

  allocateData(len: number): boolean {
    if (this.data.length === len) return true;
    this.data = new Uint8Array(len);
    return true;
  }
  deallocateData() {
    this.data = new Uint8Array(0);
  }
  markForReset() {
    this.reset = true;
  }
  resetIfRequired() {
    if (!this.reset || !this.isActive) return;
    this.data.fill(0);
    this.state = null;
    this.pixels.fill(0);
    this._step = 0;
    this._call = 0;
    this._aux0 = 0;
    this._aux1 = 0;
    this.reset = false;
  }

  // ---- colors & palettes ----

  getCurrentColor(i: number) { return this.currentColors[i < 3 ? i : 0]!; }

  loadPalette(target: Palette16, pal: number) {
    if (pal === 0) pal = this.defaultPalette;
    const c = this.colors;
    switch (pal) {
      case 1: target.set(this.strip.randomPalette); break;
      case 2: target.set(palette16(c[0])); break;
      case 3: target.set(palette16(c[0], c[0], c[1], c[1])); break;
      case 4: target.set(palette16(c[2], c[1], c[0])); break;
      case 5:
        if (c[2]) target.set(palette16(c[0], c[0], c[0], c[0], c[0], c[1], c[1], c[1], c[1], c[1], c[2], c[2], c[2], c[2], c[2], c[0]));
        else target.set(palette16(c[0], c[0], c[0], c[0], c[0], c[0], c[0], c[0], c[1], c[1], c[1], c[1], c[1], c[1], c[1], c[1]));
        break;
      default:
        if (pal >= DYNAMIC_PALETTE_COUNT && pal < DYNAMIC_PALETTE_COUNT + FASTLED_PALETTE_COUNT) target.set(fastled[pal - DYNAMIC_PALETTE_COUNT]!);
        else if (pal >= DYNAMIC_PALETTE_COUNT + FASTLED_PALETTE_COUNT && pal < FIXED_PALETTE_COUNT)
          target.set(builtinGradients[pal - DYNAMIC_PALETTE_COUNT - FASTLED_PALETTE_COUNT]!);
        else target.set(PARTY);
    }
  }

  beginDraw() {
    for (let i = 0; i < 3; i++) this.currentColors[i] = this.colors[i]!;
    if (this.customPalette) this.currentPalette.set(this.customPalette);
    else this.loadPalette(this.currentPalette, this.palette);
  }

  /** The palette ID effects see: a library palette counts as a non-default palette. */
  get paletteId() { return this.customPalette ? 255 : this.palette; }

  color_from_palette(i: number, mapping: boolean, moving: boolean, mcol: number, pbri = 255): number {
    const color = this.getCurrentColor(mcol);
    if (this.paletteId === 0 && mcol < 3) return color_fade(color, pbri, true);
    let paletteIndex = i & 0xffff;
    if (mapping) paletteIndex = Math.min(Math.trunc((paletteIndex * 255) / this.vLength), 255);
    let blend = NOBLEND;
    switch (this.strip.paletteBlend) {
      case 0: blend = moving ? LINEARBLEND : LINEARBLEND_NOWRAP; break;
      case 1: blend = LINEARBLEND; break;
      case 2: blend = LINEARBLEND_NOWRAP; break;
    }
    const c = ColorFromPalette(this.currentPalette, paletteIndex, pbri, blend);
    return (c | (W(color) << 24)) >>> 0;
  }

  color_wheel(pos: number): number {
    if (this.paletteId) return this.color_from_palette(pos & 0xff, false, true, 0);
    const rgb = hsv2rgb_rainbow((pos & 0xff) << 8, 255, 255);
    return (rgb | (W(this.getCurrentColor(0)) << 24)) >>> 0;
  }

  // ---- pixels (virtual, relative to the segment) ----

  setPixelColor(i: number, col: number) {
    if (!this.isActive || i < 0) return;
    const vL = this.vLength;
    if (i >= vL) {
      i &= 0xffff;
      if (i >= vL) return;
    }
    this.pixels[i] = col >>> 0;
  }
  setPixelColorRGB(i: number, r: number, g: number, b: number, w = 0) {
    this.setPixelColor(i, RGBW32(r, g, b, w));
  }
  getPixelColor(i: number): number {
    if (!this.isActive || i < 0) return 0;
    i &= 0xffff;
    if (i >= this.vLength) return 0;
    return this.pixels[i]!;
  }
  // 2D calls on a 1D strip map to the X axis, as with WLED_DISABLE_2D.
  setPixelColorXY(x: number, _y: number, c: number) { this.setPixelColor(x, c); }
  getPixelColorXY(x: number, _y: number) { return this.getPixelColor(x); }
  addPixelColorXY(x: number, _y: number, c: number, preserveCR = true) { this.addPixelColor(x, c, preserveCR); }
  blendPixelColor(n: number, color: number, blend: number) { this.setPixelColor(n, color_blend(this.getPixelColor(n), color, blend)); }
  addPixelColor(n: number, color: number, preserveCR = true) { this.setPixelColor(n, color_add(this.getPixelColor(n), color, preserveCR)); }
  fadePixelColor(n: number, fade: number) { this.setPixelColor(n, color_fade(this.getPixelColor(n), fade, true)); }

  fill(c: number) {
    if (!this.isActive) return;
    this.pixels.fill(c >>> 0);
  }
  clear() { this.fill(BLACK); }

  fade_out(rate: number) {
    if (!this.isActive) return;
    rate = (256 - (rate & 0xff)) >> 1;
    const mappedRate = Math.trunc(256 / (rate + 1));
    const bg = this.colors[1];
    const len = this.vLength;
    for (let j = 0; j < len; j++) {
      let color = this.pixels[j]!;
      if (color === bg) continue;
      for (let i = 0; i < 32; i += 8) {
        const c2 = (bg >>> i) & 0xff;
        const c1 = (color >>> i) & 0xff;
        let delta = Math.trunc(((c2 - c1) * mappedRate) / 256);
        if (delta === 0) delta += c2 === c1 ? 0 : c2 > c1 ? 1 : -1;
        color = ((color & ~(0xff << i)) | (((c1 + delta) & 0xff) << i)) >>> 0;
      }
      this.pixels[j] = color;
    }
  }
  fadeToSecondaryBy(fadeBy: number) {
    if (!this.isActive || !fadeBy) return;
    const len = this.vLength;
    for (let i = 0; i < len; i++) this.pixels[i] = color_blend(this.pixels[i]!, this.colors[1], fadeBy);
  }
  fadeToBlackBy(fadeBy: number) {
    fadeBy &= 0xff;
    if (!this.isActive || !fadeBy) return;
    const len = this.vLength;
    for (let i = 0; i < len; i++) this.pixels[i] = fast_color_scale(this.pixels[i]!, 255 - fadeBy);
  }
  blur(amount: number, smear = false) {
    amount &= 0xff;
    if (!this.isActive || !amount) return;
    const keep = smear ? 255 : 255 - amount;
    const seep = amount >> 1;
    const len = this.vLength;
    let cur = this.pixels[0]!;
    let carry = fast_color_scale(cur, seep);
    this.pixels[0] = fast_color_scale(cur, keep);
    for (let i = 1; i < len; i++) {
      cur = this.pixels[i]!;
      const part = fast_color_scale(cur, seep);
      cur = color_add(fast_color_scale(cur, keep), carry);
      this.pixels[i - 1] = color_add(this.pixels[i - 1]!, part);
      this.pixels[i] = cur;
      carry = part;
    }
  }
}

// ---- Blend modes (WS2812FX::blendSegment) ----

// ESP32 builds have fast integer division, so WLED uses the exact formulas.
const _multiply = (a: number, b: number) => Math.trunc((a * b) / 255);
const _divide = (a: number, b: number) => (a > b ? Math.trunc((b * 255) / a) : 255);
const blendFns: ((a: number, b: number) => number)[] = [
  (a) => a, // top
  (_a, b) => b, // bottom
  (a) => a, // add (handled below)
  (a, b) => (b > a ? b - a : 0), // subtract
  (a, b) => (b > a ? b - a : a - b), // difference
  (a, b) => (a + b) >> 1, // average
  _multiply, // multiply
  _divide, // divide
  (a, b) => (a > b ? a : b), // lighten
  (a, b) => (a < b ? a : b), // darken
  (a, b) => 255 - _multiply(255 - a, 255 - b), // screen
  (a, b) => (b < 128 ? 2 * _multiply(a, b) : 255 - 2 * _multiply(255 - a, 255 - b)), // overlay
  (a, b) => (a < 128 ? 2 * _multiply(a, b) : 255 - 2 * _multiply(255 - a, 255 - b)), // hardlight
  (a, b) => Math.trunc((b * b * (255 - 2 * a) + 255 * 2 * a * b) / (255 * 255)), // softlight
  (a, b) => _divide(255 - a, b), // dodge
  (a, b) => 255 - _divide(a, 255 - b), // burn
  (a) => a, // stencil (handled below)
];
export const BLEND_MODE_COUNT = blendFns.length;

/** How a segment pixel `t` combines with the pixel `b` already below it, for blend mode `mode` (WLED segblend). */
export function segblend(mode: number, t: number, b: number): number {
  switch (mode) {
    case 0: return t;
    case 1: return b;
    case 2: return color_add(t, b, true);
    case 16: return t ? t : b;
  }
  const f = blendFns[mode] ?? blendFns[0]!;
  return RGBW32(f(R(t), R(b)) & 0xff, f(G(t), G(b)) & 0xff, f(B(t), B(b)) & 0xff, f(W(t), W(b)) & 0xff);
}

export class Strip {
  segments: Segment[] = [];
  /** Frame buffer: one color per LED. */
  pixels: Uint32Array;
  brightness = 128;
  now = 0;
  frametime = FRAMETIME_FIXED;
  paletteBlend = 0;
  randomPalette: Palette16 = generateRandomPalette();
  private newRandomPalette: Palette16 = generateRandomPalette();
  private lastPaletteChange = 0;
  private nextPaletteBlend = 0;
  transition = 750;
  /** Effect functions by mode ID. */
  effects: Map<number, EffectFn>;

  constructor(public length: number, effects: Map<number, EffectFn>) {
    this.pixels = new Uint32Array(length);
    this.effects = effects;
  }

  setLength(n: number) {
    this.length = n;
    this.pixels = new Uint32Array(n);
  }

  /** Runs one frame at time `ms` (milliseconds since the simulation started). */
  service(ms: number) {
    this.now = ms;
    clock.millis = ms;
    for (const seg of this.segments) {
      seg.resetIfRequired();
      if (!seg.isActive || seg.freeze) continue;
      seg.beginDraw();
      const fx = this.effects.get(seg.mode) ?? this.effects.get(0)!;
      fx(seg);
      seg.call++;
    }
    this.handleRandomPalette(ms);
    this.show();
  }

  private handleRandomPalette(now: number) {
    const nowS = Math.trunc(now / 1000);
    if (nowS > this.lastPaletteChange + 5) {
      this.newRandomPalette = generateHarmonicRandomPalette(this.randomPalette);
      this.lastPaletteChange = nowS;
      this.nextPaletteBlend = now;
    }
    const frameTime = this.frametime;
    const transitionTime = this.transition;
    if (now < this.nextPaletteBlend || now > this.lastPaletteChange * 1000 + transitionTime + 2 * frameTime) return;
    const transitionFrames = frameTime > transitionTime ? 1 : Math.trunc(transitionTime / frameTime);
    const noOfBlends = transitionFrames > 255 ? 1 : Math.trunc((255 + (transitionFrames >> 1)) / transitionFrames);
    for (let i = 0; i < noOfBlends; i++) nblendPaletteTowardPalette(this.randomPalette, this.newRandomPalette, 48);
    this.nextPaletteBlend = now + (transitionFrames >> 8) * frameTime;
  }

  /** Blends the segments' current pixels into the strip. */
  show() {
    this.pixels.fill(0);
    for (const seg of this.segments) if (seg.isActive && seg.on) this.blendSegment(seg, this.pixels);
  }

  /**
   * How LED `led` got its color in the current frame: every segment whose range includes it, bottom to
   * top, with what each one blended in. Replays show() on a scratch buffer so it can't disagree with it.
   */
  explain(led: number): LedTrace {
    const buf = new Uint32Array(this.pixels.length);
    const layers: LayerTrace[] = [];
    this.segments.forEach((seg, segment) => {
      if (!seg.isActive || led < seg.start || led >= seg.stop) return;
      if (!seg.on) {
        layers.push({ segment, status: "off", writes: [] });
        return;
      }
      const writes: PixelWrite[] = [];
      this.blendSegment(seg, buf, (idx, w) => idx === led && writes.push(w));
      layers.push({ segment, status: writes.length ? "lit" : "gap", writes });
    });
    return { led, color: this.pixels[led] ?? 0, brightness: this.brightness, layers };
  }

  private blendSegment(seg: Segment, out: Uint32Array, trace?: (idx: number, w: PixelWrite) => void) {
    const length = seg.length;
    const mode = seg.blendMode < BLEND_MODE_COUNT ? seg.blendMode : 0;
    // WLED applies inverse gamma to opacity so it scales evenly after output gamma correction.
    const opacity = gamma8inv(seg.opacity);
    const nLen = seg.vLength;
    const write = (idx: number, k: number, c: number) => {
      if (idx < 0 || idx >= out.length) return;
      const below = out[idx]!;
      const blended = segblend(mode, c, below);
      out[idx] = color_blend(below, blended, opacity);
      trace?.(idx, { pixel: k, color: c, mode, opacity, below, blended, result: out[idx]! });
    };
    const put = (i: number, k: number, c: number) => {
      let idx = seg.start + i + seg.offset;
      if (idx >= seg.stop) idx -= length;
      if (seg.mirror) {
        let m = seg.stop - i - 1 + seg.offset;
        if (m >= seg.stop) m -= length;
        write(m, k, c);
      }
      write(idx, k, c);
    };
    for (let k = 0; k < nLen; k++) {
      const c = seg.pixels[k]!;
      let i = seg.reverse ? nLen - k - 1 : k;
      i *= seg.groupLength;
      const maxI = Math.min(i + seg.grouping, length);
      while (i < maxI) put(i++, k, c);
    }
  }
}

/** One segment pixel blended onto an LED. */
export interface PixelWrite {
  /** The segment's virtual pixel (after grouping, spacing, reverse and mirror). */
  pixel: number;
  /** What the effect drew there. */
  color: number;
  mode: number;
  /** Effective opacity, after WLED's inverse gamma. */
  opacity: number;
  below: number;
  /** The blend mode's result, before opacity. */
  blended: number;
  /** The LED after this write. */
  result: number;
}

export interface LayerTrace {
  /** Index into Strip.segments. */
  segment: number;
  /** lit: drew on the LED; off: segment turned off; gap: the LED falls in the segment's spacing. */
  status: "lit" | "off" | "gap";
  writes: PixelWrite[];
}

export interface LedTrace {
  led: number;
  color: number;
  brightness: number;
  layers: LayerTrace[];
}


/** Random palette in harmonic colors, keeping one color of the current one (colors.cpp). */
export function generateHarmonicRandomPalette(base: Palette16): Palette16 {
  const hues = [0, 0, 0, 0];
  const sats = [0, 0, 0, 0];
  const vals = [0, 0, 0, 0];
  const keep = hw_random8(4);
  const [h16] = rgb2hsv(base[keep * 5]!);
  hues[keep] = ((h16 >> 8) + hw_random8(10) - 5) & 0xff;
  for (let i = 0; i < 3; i++) {
    sats[i] = hw_random8(200, 255);
    vals[i] = hw_random8(220, 255);
  }
  sats[3] = hw_random8(20, 255);
  vals[3] = hw_random8(80, 255);
  for (let i = 3; i > 0; i--) {
    let j = hw_random8(i + 1);
    [sats[i], sats[j]] = [sats[j]!, sats[i]!];
    j = hw_random8(i + 1);
    [vals[i], vals[j]] = [vals[j]!, vals[i]!];
  }
  const basehue = hues[keep]!;
  let harmonics: number[];
  switch (hw_random8(5)) {
    case 0: harmonics = [basehue + hw_random8(30, 50), basehue + hw_random8(10, 30), basehue - hw_random8(10, 30)]; break;
    case 1: harmonics = [basehue + 113 + hw_random8(15), basehue + 233 + hw_random8(15), basehue - 7 + hw_random8(15)]; break;
    case 2: harmonics = [basehue + 145 + hw_random8(10), basehue + 205 + hw_random8(10), basehue - 5 + hw_random8(10)]; break;
    case 3: harmonics = [basehue + 85 + hw_random8(10), basehue + 175 + hw_random8(10), basehue + 265 + hw_random8(10)]; break;
    default: harmonics = [basehue + 80 + hw_random8(20), basehue + 170 + hw_random8(20), basehue - 15 + hw_random8(30)];
  }
  harmonics = harmonics.map((h) => h & 0xff);
  if (hw_random8() < 128) {
    for (let i = 2; i > 0; i--) {
      const j = hw_random8(i + 1);
      [harmonics[i], harmonics[j]] = [harmonics[j]!, harmonics[i]!];
    }
  }
  let j = 0;
  for (let i = 0; i < 4; i++) if (i !== keep) hues[i] = harmonics[j++]!;
  const pastel = hw_random8() < 25;
  const rgb = hues.map((h, i) => {
    let s = sats[i]!;
    if (pastel && s > 180) s -= 160;
    return CHSV(h, s, vals[i]!);
  });
  return palette16(rgb[0]!, rgb[1]!, rgb[2]!, rgb[3]!);
}
