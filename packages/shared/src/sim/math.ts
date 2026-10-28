/**
 * Integer math used by WLED effects, ported from WLED's fastled_slim, wled_math.cpp and util.cpp so the simulator
 * produces the same numbers. C integer types are emulated with masks: u8 = & 0xFF, u16 = & 0xFFFF, u32 = >>> 0.
 */

export const u8 = (x: number) => x & 0xff;
export const u16 = (x: number) => x & 0xffff;
export const u32 = (x: number) => x >>> 0;
export const i8 = (x: number) => (x << 24) >> 24;
export const i16 = (x: number) => (x << 16) >> 16;
export const i32 = (x: number) => x | 0;
/** 32-bit unsigned multiply with wrap-around, as in C. */
export const mul32 = (a: number, b: number) => Math.imul(a, b) >>> 0;

export const min = Math.min;
export const max = Math.max;
export const abs = Math.abs;
export const constrain = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
/** Arduino map(): integer, truncating toward zero. */
export const map = (x: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
  inMax === inMin ? outMin : Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
export const mapf = (x: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
  ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;

export const scale8 = (i: number, scale: number) => ((i & 0xff) * (1 + (scale & 0xff))) >> 8;
export const scale8_video = (i: number, scale: number) => (((i & 0xff) * (scale & 0xff)) >> 8) + (i && scale ? 1 : 0);
export const scale16 = (i: number, scale: number) => Math.floor(((i & 0xffff) * (1 + (scale & 0xffff))) / 65536);
export const qadd8 = (i: number, j: number) => Math.min(255, (i & 0xff) + (j & 0xff));
export const qsub8 = (i: number, j: number) => Math.max(0, (i & 0xff) - (j & 0xff));
export const qmul8 = (i: number, j: number) => Math.min(255, (i & 0xff) * (j & 0xff));
export const lerp8by8 = (a: number, b: number, frac: number) => i8(a + (((b - a) * (frac + 1)) >> 8));
export const lerp16by8 = (a: number, b: number, frac: number) => i16(a + (((b - a) * (frac + 1)) >> 8));

export function ease8InOutCubic(i: number): number {
  i &= 0xff;
  const ii = i * i;
  const factor = (3 << 8) - (i << 1);
  return u8(Math.floor((ii * factor) / 65536));
}
export function ease16InOutCubic(i: number): number {
  i &= 0xffff;
  const ii = Math.floor((i * i) / 65536);
  const factor = (3 << 16) - (i << 1);
  return u16(Math.floor((ii * factor) / 65536));
}
export function ease8InOutQuad(i: number): number {
  i &= 0xff;
  let j = i;
  if (j & 0x80) j = 255 - j;
  const jj = (j * j) >> 7;
  return i & 0x80 ? u8(255 - jj) : jj;
}
export function triwave8(x: number): number {
  x &= 0xff;
  if (x & 0x80) x = 255 - x;
  return u8(x << 1);
}
export function triwave16(x: number): number {
  x &= 0xffff;
  if (x < 0x8000) return x * 2;
  return u16(0xffff - (x - 0x8000) * 2);
}
export const quadwave8 = (x: number) => ease8InOutQuad(triwave8(x));
export const cubicwave8 = (x: number) => ease8InOutCubic(triwave8(x));

export function sin16_t(theta: number): number {
  theta &= 0xffff;
  let scale = 1;
  if (theta > 0x7fff) {
    theta = 0xffff - theta;
    scale = -1;
  }
  const precal = theta * (0x7fff - theta);
  const numerator = precal * (4 * 0x7fff);
  const denominator = 1342095361 - precal;
  return i16(Math.trunc(numerator / denominator)) * scale;
}
export const cos16_t = (theta: number) => sin16_t(theta + 0x4000);
export function sin8_t(theta: number): number {
  let s = sin16_t((theta & 0xff) * 257);
  s += 0x7fff + 128;
  return Math.min(s, 0xffff) >> 8;
}
export const cos8_t = (theta: number) => sin8_t(theta + 64);
export function sin_approx(theta: number): number {
  const scaled = Math.trunc(theta * (0xffff / (2 * Math.PI))) & 0xffff;
  return sin16_t(scaled) / 0x7fff;
}
export function cos_approx(theta: number): number {
  const scaled = Math.trunc(theta * (0xffff / (2 * Math.PI))) & 0xffff;
  return sin16_t(scaled + 0x4000) / 0x7fff;
}
export const sin_t = sin_approx;
export const cos_t = cos_approx;
export function sqrt32_bw(x: number): number {
  return Math.floor(Math.sqrt(x >>> 0));
}

// ---- Beat generators (time-based waves) ----

/** Effect time; set by the strip before each frame (WLED's millis() in beat functions). */
export const clock = { millis: 0 };

export const beat88 = (bpm88: number, timebase = 0) => u16(Math.floor((mul32(mul32(clock.millis - timebase, bpm88 & 0xffff), 280)) / 65536));
export function beat16(bpm: number, timebase = 0): number {
  bpm &= 0xffff;
  if (bpm < 256) bpm <<= 8;
  return beat88(bpm, timebase);
}
export const beat8 = (bpm: number, timebase = 0) => beat16(bpm, timebase) >> 8;
export function beatsin88_t(bpm88: number, lowest = 0, highest = 65535, timebase = 0, phase = 0): number {
  const beat = beat88(bpm88, timebase);
  const beatsin = u16(sin16_t(beat + phase) + 32768);
  const range = u16(highest - lowest);
  return u16(lowest + scale16(beatsin, range));
}
export function beatsin16_t(bpm: number, lowest = 0, highest = 65535, timebase = 0, phase = 0): number {
  const beat = beat16(bpm, timebase);
  const beatsin = u16(sin16_t(beat + phase) + 32768);
  const range = u16(highest - lowest);
  return u16(lowest + scale16(beatsin, range));
}
export function beatsin8_t(bpm: number, lowest = 0, highest = 255, timebase = 0, phase = 0): number {
  const beat = beat8(bpm, timebase);
  const beatsin = sin8_t(beat + phase);
  const range = u8(highest - lowest);
  return u8(lowest + scale8(beatsin, range));
}

// ---- Random numbers ----

/** WLED reads a hardware RNG; any good 32-bit source will do. */
export const hw_random32 = () => (Math.random() * 0x100000000) >>> 0;
export function hw_random(lo?: number, hi?: number): number {
  if (lo === undefined) return hw_random32();
  if (hi === undefined) return Math.floor((hw_random32() * (lo >>> 0)) / 0x100000000);
  if (lo >= hi) return lo;
  return Math.floor((hw_random32() * (hi - lo)) / 0x100000000) + lo;
}
export function hw_random16(lo?: number, hi?: number): number {
  const r = hw_random32() & 0xffff;
  if (lo === undefined) return r;
  if (hi === undefined) return (r * lo) >>> 16;
  return i16(lo + ((r * (hi - lo)) >>> 16));
}
export function hw_random8(lo?: number, hi?: number): number {
  const r = hw_random32() & 0xff;
  if (lo === undefined) return r;
  if (hi === undefined) return u8((r * lo) >>> 8);
  return u8(lo + ((r * u32(hi - lo)) >>> 8));
}

/** WLED's seeded 16-bit PRNG (prng.h), for effects that replay a sequence. */
export class PRNG {
  constructor(private seed = 0x1234) {}
  setSeed(s: number) {
    this.seed = s & 0xffff;
  }
  getSeed() {
    return this.seed;
  }
  random16(lo?: number, hi?: number): number {
    if (lo !== undefined && hi === undefined) return (this.random16() * lo) >>> 16;
    if (lo !== undefined && hi !== undefined) return u16(((this.random16() * u16(hi - lo)) >>> 16) + lo);
    let s = u16(this.seed * 3001 + 31683);
    s ^= s >> 7;
    this.seed = s;
    return s;
  }
  random8(lo?: number, hi?: number): number {
    if (lo !== undefined && hi === undefined) return u8((u8(this.random16()) * lo) >> 8);
    if (lo !== undefined && hi !== undefined) return u8(u8((u8(this.random16()) * u8(hi - lo)) >> 8) + lo);
    return u8(this.random16());
  }
}

export function get_random_wheel_index(pos: number): number {
  let r = 0;
  let d = 0;
  while (d < 42) {
    r = hw_random8();
    const x = Math.abs(pos - r);
    const y = 255 - x;
    d = Math.min(x, y);
  }
  return r;
}

export function hashInt(s: number): number {
  s = mul32((s >>> 16) ^ s, 0x45d9f3b);
  s = mul32((s >>> 16) ^ s, 0x45d9f3b);
  return ((s >>> 16) ^ s) >>> 0;
}

// ---- Perlin noise (WLED's fixed-point replacement for FastLED inoise) ----

const PERLIN_SHIFT = 1;
const hashToGradient = (h: number) => (h & 0x03) - 2;
function gradient1D(x0: number, dx: number): number {
  let h = mul32(x0, 0x27d4eb2d);
  h = (h ^ (h >>> 15)) >>> 0;
  h = mul32(h, 0x92c3412b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h ^ (h >>> 7)) >>> 0;
  return (hashToGradient(h) * dx) >> PERLIN_SHIFT;
}
function gradient2D(x0: number, dx: number, y0: number, dy: number): number {
  let h = (mul32(x0, 0x27d4eb2d) ^ mul32(y0, 0xb5297a4d)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = mul32(h, 0x92c3412b);
  h = (h ^ (h >>> 13)) >>> 0;
  return (hashToGradient(h) * dx + hashToGradient(h >>> PERLIN_SHIFT) * dy) >> (1 + PERLIN_SHIFT);
}
function gradient3D(x0: number, dx: number, y0: number, dy: number, z0: number, dz: number): number {
  let h = (mul32(x0, 0x27d4eb2d) ^ mul32(y0, 0xb5297a4d) ^ mul32(z0, 0x1b56c4e9)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = mul32(h, 0x92c3412b);
  h = (h ^ (h >>> 13)) >>> 0;
  return (
    ((hashToGradient(h) * dx + hashToGradient(h >>> (1 + PERLIN_SHIFT)) * dy + hashToGradient(h >>> (1 + 2 * PERLIN_SHIFT)) * dz) * 85) >>
    (8 + PERLIN_SHIFT)
  );
}
function smoothstep(t: number): number {
  const tSquared = Math.floor((t * t) / 65536);
  const factor = (3 << 16) - (t << 1);
  return Math.floor((tSquared * factor) / 262144);
}
const lerpPerlin = (a: number, b: number, t: number) => a + (((b - a) * t) >> 14);

export function perlin1D_raw(x: number, is16bit = false): number {
  x >>>= 0;
  const x0 = x >>> 16;
  let x1 = x0 + 1;
  if (is16bit) x1 &= 0xff;
  const dx0 = x & 0xffff;
  const dx1 = dx0 - 0x10000;
  return lerpPerlin(gradient1D(x0, dx0), gradient1D(x1, dx1), smoothstep(dx0));
}
export function perlin2D_raw(x: number, y: number, is16bit = false): number {
  x >>>= 0;
  y >>>= 0;
  const x0 = x >>> 16;
  const y0 = y >>> 16;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  if (is16bit) {
    x1 &= 0xff;
    y1 &= 0xff;
  }
  const dx0 = x & 0xffff;
  const dy0 = y & 0xffff;
  const dx1 = dx0 - 0x10000;
  const dy1 = dy0 - 0x10000;
  const tx = smoothstep(dx0);
  const ty = smoothstep(dy0);
  const nx0 = lerpPerlin(gradient2D(x0, dx0, y0, dy0), gradient2D(x1, dx1, y0, dy0), tx);
  const nx1 = lerpPerlin(gradient2D(x0, dx0, y1, dy1), gradient2D(x1, dx1, y1, dy1), tx);
  return lerpPerlin(nx0, nx1, ty);
}
export function perlin3D_raw(x: number, y: number, z: number, is16bit = false): number {
  x >>>= 0;
  y >>>= 0;
  z >>>= 0;
  const x0 = x >>> 16;
  const y0 = y >>> 16;
  const z0 = z >>> 16;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let z1 = z0 + 1;
  if (is16bit) {
    x1 &= 0xff;
    y1 &= 0xff;
    z1 &= 0xff;
  }
  const dx0 = x & 0xffff;
  const dy0 = y & 0xffff;
  const dz0 = z & 0xffff;
  const dx1 = dx0 - 0x10000;
  const dy1 = dy0 - 0x10000;
  const dz1 = dz0 - 0x10000;
  const tx = smoothstep(dx0);
  const ty = smoothstep(dy0);
  const tz = smoothstep(dz0);
  const nx0 = lerpPerlin(gradient3D(x0, dx0, y0, dy0, z0, dz0), gradient3D(x1, dx1, y0, dy0, z0, dz0), tx);
  const nx1 = lerpPerlin(gradient3D(x0, dx0, y1, dy1, z0, dz0), gradient3D(x1, dx1, y1, dy1, z0, dz0), tx);
  const nx2 = lerpPerlin(gradient3D(x0, dx0, y0, dy0, z1, dz1), gradient3D(x1, dx1, y0, dy0, z1, dz1), tx);
  const nx3 = lerpPerlin(gradient3D(x0, dx0, y1, dy1, z1, dz1), gradient3D(x1, dx1, y1, dy1, z1, dz1), tx);
  return lerpPerlin(lerpPerlin(nx0, nx1, ty), lerpPerlin(nx2, nx3, ty), tz);
}
export function perlin16(x: number, y?: number, z?: number): number {
  if (y === undefined) return u16(((perlin1D_raw(x) * 1159) >> 10) + 32803);
  if (z === undefined) return u16(((perlin2D_raw(x, y) * 1537) >> 10) + 32725);
  return u16(((perlin3D_raw(x, y, z) * 1731) >> 10) + 33147);
}
export function perlin8(x: number, y?: number, z?: number): number {
  x &= 0xffff;
  if (y === undefined) return u8((((perlin1D_raw(x << 8, true) * 1353) >> 10) + 32769) >> 8);
  y &= 0xffff;
  if (z === undefined) return u8((((perlin2D_raw(x << 8, y << 8, true) * 1620) >> 10) + 32771) >> 8);
  z &= 0xffff;
  return u8((((perlin3D_raw(x << 8, y << 8, z << 8, true) * 2015) >> 10) + 33168) >> 8);
}
export const inoise8 = perlin8;
export const inoise16 = perlin16;
