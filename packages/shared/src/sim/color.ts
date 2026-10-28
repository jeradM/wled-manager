/**
 * WLED color math (colors.cpp, fastled_slim), on 32-bit colors packed as 0xWWRRGGBB like WLED's.
 */
import { hw_random8 } from "./math.js";

export const RGBW32 = (r: number, g: number, b: number, w = 0) =>
  (((w & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
export const R = (c: number) => (c >>> 16) & 0xff;
export const G = (c: number) => (c >>> 8) & 0xff;
export const B = (c: number) => c & 0xff;
export const W = (c: number) => (c >>> 24) & 0xff;

export const BLACK = 0;
export const WHITE = 0xffffff;
export const RED = 0xff0000;
export const GREEN = 0x00ff00;
export const BLUE = 0x0000ff;
export const ORANGE = 0xff3000;
export const PINK = 0xff1493;
export const ULTRAWHITE = 0xffffffff;
export const DEFAULT_COLOR = 0xffa000;

/** result = (c1 * (256 - blend) + c2 + c2 * blend) / 256 per channel */
export function color_blend(c1: number, c2: number, blend: number): number {
  blend &= 0xff;
  const ch = (a: number, b: number) => ((((a << 8) | b) + b * blend - a * blend) >> 8) & 0xff;
  return RGBW32(ch(R(c1), R(c2)), ch(G(c1), G(c2)), ch(B(c1), B(c2)), ch(W(c1), W(c2)));
}
export const color_blend16 = (c1: number, c2: number, b: number) => color_blend(c1, c2, (b & 0xffff) >> 8);

export function color_add(c1: number, c2: number, preserveCR = false): number {
  c1 >>>= 0;
  c2 >>>= 0;
  if (c1 === 0) return c2;
  if (c2 === 0) return c1;
  let r = R(c1) + R(c2);
  let g = G(c1) + G(c2);
  let b = B(c1) + B(c2);
  let w = W(c1) + W(c2);
  if (preserveCR) {
    if (r > 255 || g > 255 || b > 255 || w > 255) {
      const maxval = Math.max(r, g, b, w);
      const scale = Math.floor((255 << 8) / maxval);
      r = (r * scale) >> 8;
      g = (g * scale) >> 8;
      b = (b * scale) >> 8;
      w = (w * scale) >> 8;
    }
  } else {
    r = Math.min(r, 255);
    g = Math.min(g, 255);
    b = Math.min(b, 255);
    w = Math.min(w, 255);
  }
  return RGBW32(r, g, b, w);
}

/** Fades toward black; "video" keeps dominant channels lit so a color never quite reaches black. */
export function color_fade(c1: number, amount: number, video = false): number {
  c1 >>>= 0;
  amount &= 0xff;
  if (c1 === 0) return 0;
  if (amount === 255) return c1;
  if (amount === 0) return 0;
  const r = R(c1);
  const g = G(c1);
  const b = B(c1);
  const w = W(c1);
  if (video) {
    const maxc = Math.max(r, g, b);
    const thr = (maxc >> 1) + 1;
    const dom = (v: number) => (v >= thr ? 1 : 0);
    return RGBW32(((r * amount) >> 8) + dom(r), ((g * amount) >> 8) + dom(g), ((b * amount) >> 8) + dom(b), ((w * amount) >> 8) + dom(w));
  }
  const s = amount + 1;
  return RGBW32((r * s) >> 8, (g * s) >> 8, (b * s) >> 8, (w * s) >> 8);
}

export function fast_color_scale(c: number, scale: number): number {
  scale &= 0xff;
  return RGBW32((R(c) * scale) >> 8, (G(c) * scale) >> 8, (B(c) * scale) >> 8, (W(c) * scale) >> 8);
}

/** FastLED "rainbow" HSV -> RGB with a 16-bit hue. Returns 0x00RRGGBB. */
export function hsv2rgb_rainbow(h: number, s: number, v: number): number {
  h &= 0xffff;
  const hue = h >> 8;
  const sat = s & 0xff;
  const val = v & 0xff;
  const offset = h & 0x1fff;
  const third16 = offset * 21846;
  const third = (third16 >>> 21) & 0xff;
  let r: number, g: number, b: number;
  if (!(hue & 0x80)) {
    if (!(hue & 0x40)) {
      if (!(hue & 0x20)) [r, g, b] = [255 - third, third, 0];
      else [r, g, b] = [171, 85 + third, 0];
    } else if (!(hue & 0x20)) {
      const twothirds = (third16 >>> 20) & 0xff;
      [r, g, b] = [171 - twothirds, 170 + third, 0];
    } else [r, g, b] = [0, 255 - third, third];
  } else if (!(hue & 0x40)) {
    if (!(hue & 0x20)) {
      const twothirds = (third16 >>> 20) & 0xff;
      [r, g, b] = [0, 171 - twothirds, 85 + twothirds];
    } else [r, g, b] = [third, 0, 255 - third];
  } else if (!(hue & 0x20)) [r, g, b] = [85 + third, 0, 171 - third];
  else [r, g, b] = [170 + third, 0, 85 - third];
  r &= 0xff;
  g &= 0xff;
  b &= 0xff;
  if (sat !== 255) {
    if (sat === 0) [r, g, b] = [255, 255, 255];
    else {
      let desat = 255 - sat;
      desat = desat * desat;
      const floor = desat >> 8;
      const satscale = 0xffff - desat;
      if (r) r = (r * satscale) >>> 16;
      if (g) g = (g * satscale) >>> 16;
      if (b) b = (b * satscale) >>> 16;
      r = (r + floor) & 0xff;
      g = (g + floor) & 0xff;
      b = (b + floor) & 0xff;
    }
  }
  if (val !== 255) {
    if (val === 0) [r, g, b] = [0, 0, 0];
    else {
      const vv = val * val + 512;
      if (r) r = (((r * vv) >>> 16) + 1) & 0xff;
      if (g) g = (((g * vv) >>> 16) + 1) & 0xff;
      if (b) b = (((b * vv) >>> 16) + 1) & 0xff;
    }
  }
  return RGBW32(r, g, b);
}
/** CHSV (8-bit hue) -> RGB, as CRGB(CHSV(h, s, v)). */
export const CHSV = (h: number, s = 255, v = 255) => hsv2rgb_rainbow((h & 0xff) << 8, s, v);
/** CHSV32 (16-bit hue) -> RGB. */
export const CHSV32 = (h: number, s = 255, v = 255) => hsv2rgb_rainbow(h, s, v);

export function hsv2rgb_spectrum(h: number, s: number, v: number): number {
  h &= 0xffff;
  s &= 0xff;
  v &= 0xff;
  const region = (h * 6) >>> 16;
  const remainder = ((h - region * 10923) * 6) & 0xffffffff;
  if (s === 0) return RGBW32(v, v, v);
  const p = (v * (255 - s)) >> 8;
  const q = (v * (255 - ((s * remainder) >>> 16))) >> 8;
  const t = (v * (255 - ((s * (65535 - remainder)) >>> 16))) >> 8;
  switch (region) {
    case 0: return RGBW32(v, t, p);
    case 1: return RGBW32(q, v, p);
    case 2: return RGBW32(p, v, t);
    case 3: return RGBW32(p, q, v);
    case 4: return RGBW32(t, p, v);
    default: return RGBW32(v, p, q);
  }
}

/** RGB -> HSV with 16-bit hue: [h, s, v]. */
export function rgb2hsv(c: number): [number, number, number] {
  const r = R(c);
  const g = G(c);
  const b = B(c);
  const maxval = Math.max(r, g, b);
  if (maxval === 0) return [0, 0, 0];
  const minval = Math.min(r, g, b);
  const delta = maxval - minval;
  if (delta === 0) return [0, 0, maxval];
  const s = Math.trunc((255 * delta) / maxval);
  let h: number;
  if (maxval === r) h = Math.trunc((10923 * (g - b)) / delta);
  else if (maxval === g) h = 21845 + Math.trunc((10923 * (b - r)) / delta);
  else h = 43690 + Math.trunc((10923 * (r - g)) / delta);
  return [h & 0xffff, s, maxval];
}

export function colorHStoRGB(hue: number, sat: number): number {
  return hsv2rgb_spectrum(hue, sat, 255);
}

/** Black-body heat color for 0-255 temperature. */
export function HeatColor(temperature: number): number {
  temperature &= 0xff;
  const t192 = ((temperature * 191) >> 8) + (temperature ? 1 : 0);
  const heatramp = ((t192 & 0x3f) << 2) & 0xff;
  if (t192 & 0x80) return RGBW32(255, 255, heatramp);
  if (t192 & 0x40) return RGBW32(255, heatramp, 0);
  return RGBW32(heatramp, 0, 0);
}

// ---- 16-entry palettes (CRGBPalette16) ----

/** 16 RGB entries (0x00RRGGBB). */
export type Palette16 = Uint32Array;

export function fillGradient(entries: Palette16, startpos: number, startcolor: number, endpos: number, endcolor: number) {
  if (endpos < startpos) {
    [startpos, endpos] = [endpos, startpos];
    [startcolor, endcolor] = [endcolor, startcolor];
  }
  const divisor = endpos - startpos || 1;
  const rdelta = Math.trunc(((R(endcolor) - R(startcolor)) << 16) / divisor);
  const gdelta = Math.trunc(((G(endcolor) - G(startcolor)) << 16) / divisor);
  const bdelta = Math.trunc(((B(endcolor) - B(startcolor)) << 16) / divisor);
  let r = R(startcolor) << 16;
  let g = G(startcolor) << 16;
  let b = B(startcolor) << 16;
  for (let i = startpos; i <= endpos; i++) {
    entries[i] = RGBW32(r >> 16, g >> 16, b >> 16);
    r += rdelta;
    g += gdelta;
    b += bdelta;
  }
}

/** CRGBPalette16 from 1 to 4 colors (solid, or evenly spread gradient), or 16 colors. */
export function palette16(...colors: number[]): Palette16 {
  const p = new Uint32Array(16);
  if (colors.length === 16) colors.forEach((c, i) => (p[i] = c & 0xffffff));
  else if (colors.length === 1) p.fill(colors[0]! & 0xffffff);
  else if (colors.length === 2) fillGradient(p, 0, colors[0]!, 15, colors[1]!);
  else if (colors.length === 3) {
    fillGradient(p, 0, colors[0]!, 8, colors[1]!);
    fillGradient(p, 8, colors[1]!, 15, colors[2]!);
  } else if (colors.length === 4) {
    fillGradient(p, 0, colors[0]!, 5, colors[1]!);
    fillGradient(p, 5, colors[1]!, 10, colors[2]!);
    fillGradient(p, 10, colors[2]!, 15, colors[3]!);
  }
  return p;
}

/**
 * Loads a gradient palette given as [index, r, g, b, ...] (ending with index 255) into 16 entries, exactly as
 * CRGBPalette16::loadDynamicGradientPalette does.
 */
export function gradientPalette(bytes: ArrayLike<number>): Palette16 {
  const p = new Uint32Array(16);
  let count = 0;
  while (count * 4 < bytes.length) {
    count++;
    if (bytes[(count - 1) * 4] === 255) break;
  }
  let lastSlotUsed = -1;
  let k = 0;
  let rgbstart = RGBW32(bytes[1]!, bytes[2]!, bytes[3]!);
  let indexstart = 0;
  while (indexstart < 255) {
    k++;
    const indexend = bytes[k * 4] ?? 255;
    const rgbend = RGBW32(bytes[k * 4 + 1] ?? 255, bytes[k * 4 + 2] ?? 255, bytes[k * 4 + 3] ?? 255);
    let istart8 = indexstart >> 4;
    let iend8 = indexend >> 4;
    if (count < 16) {
      if (istart8 <= lastSlotUsed && lastSlotUsed < 15) {
        istart8 = lastSlotUsed + 1;
        if (iend8 < istart8) iend8 = istart8;
      }
      lastSlotUsed = iend8;
    }
    fillGradient(p, istart8, rgbstart, iend8, rgbend);
    indexstart = indexend;
    rgbstart = rgbend;
  }
  return p;
}

export const NOBLEND = 0;
export const LINEARBLEND = 1;
export const LINEARBLEND_NOWRAP = 2;

export function ColorFromPalette(pal: Palette16, index: number, brightness = 255, blendType = LINEARBLEND): number {
  index >>>= 0;
  if (blendType === LINEARBLEND_NOWRAP) index = (index * 0xf0) >>> 8;
  const hi4 = (index & 0xff) >> 4;
  const lo4 = index & 0x0f;
  const e1 = pal[hi4]!;
  let r = R(e1);
  let g = G(e1);
  let b = B(e1);
  if (lo4 && blendType !== NOBLEND) {
    const e2 = pal[hi4 === 15 ? 0 : hi4 + 1]!;
    const f2 = lo4 << 4;
    const f1 = 256 - f2;
    r = (r * f1 + R(e2) * f2) >> 8;
    g = (g * f1 + G(e2) * f2) >> 8;
    b = (b * f1 + B(e2) * f2) >> 8;
  }
  brightness &= 0xff;
  if (brightness < 255) {
    const scale = brightness + 1;
    r = (r * scale) >> 8;
    g = (g * scale) >> 8;
    b = (b * scale) >> 8;
  }
  return RGBW32(r, g, b);
}

/** Moves `current` up to `maxChanges` channel steps toward `target` (in place). */
export function nblendPaletteTowardPalette(current: Palette16, target: Palette16, maxChanges: number) {
  // CRGB entries are stored r, g, b; walk the channels in that order like FastLED.
  let changes = 0;
  for (let i = 0; i < 16; i++) {
    const ch = [R(current[i]!), G(current[i]!), B(current[i]!)];
    const tg = [R(target[i]!), G(target[i]!), B(target[i]!)];
    let done = false;
    for (let k = 0; k < 3; k++) {
      if (ch[k] === tg[k]) continue;
      if (ch[k]! < tg[k]!) {
        ch[k] = ch[k]! + 1;
        changes++;
      }
      if (ch[k]! > tg[k]!) {
        ch[k] = ch[k]! - 1;
        changes++;
        if (ch[k]! > tg[k]!) ch[k] = ch[k]! - 1;
      }
      if (changes >= maxChanges) {
        done = true;
        break;
      }
    }
    current[i] = RGBW32(ch[0]!, ch[1]!, ch[2]!);
    if (done) break;
  }
}

export function generateRandomPalette(): Palette16 {
  const c = () => CHSV(hw_random8(), hw_random8(160, 255), hw_random8(128, 255));
  return palette16(c(), c(), c(), c());
}

// ---- Gamma (default 2.2) ----

export const GAMMA = 2.2;
export const gammaT = new Uint8Array(256);
export const gammaTInv = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
  gammaT[i] = Math.trunc(Math.pow(i / 255, GAMMA) * 255 + 0.5);
  gammaTInv[i] = Math.trunc(Math.pow((i - 0.5) / 255, 1 / GAMMA) * 255 + 0.5);
}
export const gamma8 = (v: number) => gammaT[v & 0xff]!;
export const gamma8inv = (v: number) => gammaTInv[v & 0xff]!;
export const gamma32 = (c: number) => RGBW32(gammaT[R(c)]!, gammaT[G(c)]!, gammaT[B(c)]!, gammaT[W(c)]!);
export const gamma32inv = (c: number) => RGBW32(gammaTInv[R(c)]!, gammaTInv[G(c)]!, gammaTInv[B(c)]!, gammaTInv[W(c)]!);
