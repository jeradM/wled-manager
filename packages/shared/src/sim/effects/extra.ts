/**
 * WLED effects ported from FX.cpp (WLED main): Aurora, Color Clouds, WLED-SR 1D effects, Shimmer, Slow Transition.
 */
import { CHSV, ColorFromPalette, LINEARBLEND_NOWRAP, R, G, B, W, RGBW32, color_add, color_blend, color_fade, gamma8inv } from "../color.js";
import { beat88, beatsin8_t, constrain, cos8_t, hw_random, hw_random16, hw_random8, map, mul32, perlin16, sin16_t, sin8_t, u8 } from "../math.js";
import type { Segment } from "../segment.js";
import { mode_static } from "./basic.js";
import { SOLID_WRAP, type Registry } from "./common.js";

const W_MAX_COUNT = 20;
const W_MAX_SPEED = 6;
const W_WIDTH_FACTOR = 6;
const AW_SHIFT = 16;
const AW_SCALE = 1 << AW_SHIFT;

class AuroraWave {
  center = 0;
  ageFactor = 0;
  ttl = 0;
  age = 0;
  width = 0;
  basealpha = 0;
  speedFactor = 0;
  waveStart = 0;
  waveEnd = 0;
  goingleft = false;
  alive = false; // zeroed SEGENV.data: all waves start dead
  basecolor = 0;

  init(len: number, color: number) {
    this.ttl = hw_random16(500, 1501);
    this.basecolor = color;
    this.basealpha = Math.floor((hw_random8(60, 100) * AW_SCALE) / 100);
    this.age = 0;
    this.width = hw_random16(Math.floor(len / 20), Math.floor(len / W_WIDTH_FACTOR)) + 1;
    this.center = (Math.floor((hw_random8(101) * AW_SCALE) / 100) * len) | 0;
    this.goingleft = (hw_random8() & 1) === 1;
    this.speedFactor = Math.floor(((hw_random8(10, 31) * W_MAX_SPEED) << AW_SHIFT) / (100 * 255));
    this.alive = true;
  }

  updateCachedValues() {
    const halfTtl = this.ttl >> 1;
    this.ageFactor =
      this.age < halfTtl ? Math.floor((this.age * AW_SCALE) / halfTtl) : Math.floor((((this.ttl - this.age) & 0xffff) * AW_SCALE) / halfTtl);
    if (this.ageFactor >= AW_SCALE) this.ageFactor = AW_SCALE - 1;
    const centerLed = (this.center >>> AW_SHIFT) << 16 >> 16;
    this.waveStart = centerLed - this.width;
    this.waveEnd = centerLed + this.width;
  }

  colorFor(i: number): number {
    if (i < this.waveStart || i > this.waveEnd) return 0;
    const offset = Math.abs(i * AW_SCALE - this.center);
    const offsetFactor = Math.floor(offset / this.width);
    if (offsetFactor > AW_SCALE) return 0;
    let f = AW_SCALE - offsetFactor;
    f = Math.floor((f * this.ageFactor) / AW_SCALE);
    f = Math.floor((f * this.basealpha) / AW_SCALE);
    const c = this.basecolor;
    const sc = (v: number) => Math.floor((v * f) / AW_SCALE);
    return RGBW32(sc(R(c)), sc(G(c)), sc(B(c)), sc(W(c)));
  }

  update(len: number, speed: number) {
    const step = this.speedFactor * speed;
    this.center += this.goingleft ? -step : step;
    this.age = (this.age + 1) & 0xffff;
    if (this.age > this.ttl) this.alive = false;
    else if (this.goingleft ? this.center < -(this.width * AW_SCALE) : this.center > (len + this.width) * AW_SCALE) this.alive = false;
  }
}

export function mode_aurora(s: Segment) {
  const SEGLEN = s.vLength;
  s.aux1 = map(s.intensity, 0, 255, 2, W_MAX_COUNT);
  if (!s.state) s.state = [] as AuroraWave[];
  const waves = s.state as AuroraWave[];
  while (waves.length < s.aux1) waves.push(new AuroraWave());
  for (let i = 0; i < s.aux1; i++) {
    const w = waves[i]!;
    w.update(SEGLEN, s.speed);
    if (!w.alive) w.init(SEGLEN, s.color_from_palette(hw_random8(), false, false, hw_random8(0, 3)));
    w.updateCachedValues();
  }
  let backlight = 0;
  for (let k = 0; k < 3; k++) if (s.getCurrentColor(k)) backlight++;
  backlight = gamma8inv(backlight);
  for (let i = 0; i < SEGLEN; i++) {
    let mixed = RGBW32(backlight, backlight, backlight);
    for (let j = 0; j < s.aux1; j++) mixed = color_add(mixed, waves[j]!.colorFor(i));
    s.setPixelColor(i, mixed);
  }
}

export function mode_color_clouds(s: Segment) {
  if (s.call === 0) {
    s.aux0 = hw_random16();
    s.aux1 = hw_random16();
  }
  const volX0 = s.aux0;
  const hueX0 = s.aux1;
  const hueOffset0 = u8(volX0 + hueX0);
  const volSqueeze = 8 + s.custom1;
  const volCutoff = 12500 + s.custom3 * 900;
  const volSaturate = 52000;
  const volT = Math.floor(mul32(s.now, 1 + s.speed) / 8);
  const hueT = Math.floor(mul32(s.now, 1 + s.intensity) / 8);
  const hueOffset = beat88(64) >> 8;
  for (let i = 0; i < s.vLength; i++) {
    let vol = perlin16((volX0 + i * volSqueeze * 64) >>> 0, volT);
    vol = constrain(map(vol, volCutoff, volSaturate, 0, 255), 0, 255);
    let hue = u8((perlin16((hueX0 + i * s.custom2 * 8) >>> 0, hueT) >> 7) + hueOffset0 + hueOffset);
    if (s.check3) hue = cos8_t(128 + (hue >> 1));
    let pixel = s.palette ? s.color_from_palette(hue, false, true, 0, vol) : CHSV(hue, 255, vol);
    if (R(pixel) + G(pixel) + B(pixel) <= 2) pixel = 0;
    s.setPixelColor(i, pixel);
  }
}

export function mode_perlinmove(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.fade_out(255 - s.custom1);
  const t = Math.floor((s.now * 128) / (260 - s.speed)) >>> 0;
  for (let i = 0; i < (s.intensity >> 4) + 1; i++) {
    const locn = perlin16((t + i * 15000) >>> 0, t);
    const pixloc = map(locn, 50 * 256, 192 * 256, 0, SEGLEN - 1) >>> 0;
    s.setPixelColor(pixloc, s.color_from_palette(pixloc % 255, false, SOLID_WRAP(s), 0));
  }
}

export function mode_wavesins(s: Segment) {
  for (let i = 0; i < s.vLength; i++) {
    const bri = sin8_t((s.now >>> 2) + i * s.intensity);
    const index = beatsin8_t(s.speed, s.custom1, u8(s.custom1 + s.custom2), 0, u8(i * (s.custom3 << 3)));
    s.setPixelColor(i, s.color_from_palette(index, false, SOLID_WRAP(s), 0, bri));
  }
}

export function mode_flow_stripe(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const hl = Math.floor((SEGLEN * 10) / 13);
  const hue = u8(Math.floor(s.now / (s.speed + 1)));
  const t = Math.floor(s.now / ((s.intensity >> 3) + 1)) >>> 0;
  for (let i = 0; i < SEGLEN; i++) {
    let c = Math.trunc((Math.abs(i - hl) * 127) / hl);
    c = sin8_t(c);
    c = sin8_t((c >> 1) + t);
    const b = sin8_t(c + (t >>> 3));
    s.setPixelColor(i, s.color_from_palette(u8(b + hue), false, true, 3));
  }
}

export function mode_shimmer(s: Segment) {
  const SEGLEN = s.vLength;
  if (!s.state) s.state = { lastTime: 0 };
  const st = s.state as { lastTime: number };
  const radius = ((s.custom1 * SEGLEN) >> 7) + 1;
  const traversalDistance = (SEGLEN + 2 * radius) << 8;
  const traversalTime = 200 + (255 - s.speed) * 80;
  const speed = Math.floor((traversalDistance << 5) / traversalTime);
  let position = s.step | 0;
  const inputstate = ((s.intensity << 8) | s.custom1) & 0xffff;
  if (s.call === 0 || inputstate !== s.aux1) {
    position = -(radius << 8);
    s.aux0 = 0;
    st.lastTime = s.now;
    s.aux1 = inputstate;
  }
  if (s.speed) {
    const deltaTime = (s.now - st.lastTime) & 0x7f;
    st.lastTime = s.now;
    if (s.aux0 > 0) s.aux0 = s.aux0 > deltaTime ? s.aux0 - deltaTime : 0;
    else {
      position += 1 + ((speed * deltaTime) >> 5);
      if (position > (SEGLEN + radius) << 8) {
        s.aux0 = s.intensity * 236;
        if (s.check3) s.aux0 = hw_random(s.aux0 + 1000);
        position = -(radius << 8);
      }
      s.step = position >>> 0;
    }
    if (s.check2) position = (SEGLEN << 8) - position;
  } else position = SEGLEN << 7;
  for (let i = 0; i < SEGLEN; i++) {
    const dist = Math.abs(position - (i << 8));
    if (dist < radius << 8) {
      let color = s.color_from_palette(Math.floor((i * 255) / SEGLEN), false, false, 0);
      const blend = Math.floor(dist / radius) & 0xff;
      if (s.custom2) {
        const modVal = s.check1
          ? u8((sin16_t((((i * s.custom2) << 6) + mul32(mul32(s.now, s.custom3), 32)) & 0xffff) >> 8) + 128)
          : perlin16((i * s.custom2) << 7, mul32(mul32(s.now, s.custom3), 32)) >> 8;
        color = color_fade(color, modVal, true);
      }
      s.setPixelColor(i, color_blend(color, s.getCurrentColor(1), blend));
    } else s.setPixelColor(i, s.getCurrentColor(1));
  }
}

type SlowTransition = { start: Uint32Array; current: Uint32Array; end: Uint32Array; startWhite: number; currentWhite: number; endWhite: number };
const samePalette = (a: Uint32Array, b: Uint32Array) => a.every((v, i) => v === b[i]);
export function mode_slow_transition(s: Segment) {
  const pal = s.currentPalette;
  const white = W(s.getCurrentColor(0));
  if (!s.state) s.state = { start: new Uint32Array(16), current: new Uint32Array(16), end: new Uint32Array(16), startWhite: 0, currentWhite: 0, endWhite: 0 } satisfies SlowTransition;
  const d = s.state as SlowTransition;
  const changed = !samePalette(d.end, pal) || s.aux1 !== s.speed || d.endWhite !== white;
  if (changed || s.call === 0) {
    if (s.call === 0) {
      d.start.set(pal);
      d.current.set(pal);
      d.end.set(pal);
      d.startWhite = d.currentWhite = d.endWhite = white;
      s.aux0 = 0xffff;
    } else {
      d.start.set(d.current);
      d.end.set(pal);
      d.startWhite = d.currentWhite;
      d.endWhite = white;
      s.aux0 = 0;
    }
    s.aux1 = s.speed;
    s.step = s.now;
  }
  const totalSteps = s.check2 ? 16 * 255 : 255;
  const duration = s.speed === 0 ? 10000 : s.speed * 60000;
  const elapsed = (s.now - s.step) >>> 0;
  const expected = Math.min(Math.floor((elapsed * totalSteps) / duration), totalSteps);
  if (s.aux0 > expected) s.aux0 = expected;
  if (s.aux0 < expected) {
    s.aux0 = expected;
    let amt: number;
    if (s.check2) {
      const i = s.aux0 % 16;
      amt = Math.floor(s.aux0 / 16) & 0xff;
      d.current[i] = color_blend(d.start[i]!, d.end[i]!, amt) & 0xffffff;
    } else {
      amt = s.aux0 & 0xff;
      for (let i = 0; i < 16; i++) d.current[i] = color_blend(d.start[i]!, d.end[i]!, amt) & 0xffffff;
    }
    d.currentWhite = Math.floor((d.startWhite * (255 - amt) + d.endWhite * amt) / 255);
    if (s.aux0 >= totalSteps) {
      d.current.set(d.end);
      d.currentWhite = d.endWhite;
    }
  }
  for (let i = 0; i < s.vLength; i++) {
    const c = ColorFromPalette(d.current, Math.floor((i * 255) / s.vLength), 255, LINEARBLEND_NOWRAP);
    s.setPixelColor(i, ((c & 0xffffff) | (d.currentWhite << 24)) >>> 0);
  }
}

export const extraEffects: Registry = {
  38: mode_aurora,
  147: mode_perlinmove,
  161: mode_shimmer,
  179: mode_flow_stripe,
  184: mode_wavesins,
  218: mode_color_clouds,
  219: mode_slow_transition,
};
