/**
 * WLED effects ported from FX.cpp (WLED main): Chase variants through Ripple.
 */
import {
  CHSV,
  ColorFromPalette,
  NOBLEND,
  R,
  G,
  B,
  W,
  RGBW32,
  color_add,
  color_blend,
  color_fade,
  gamma32inv,
  gamma8,
  gamma8inv,
} from "../color.js";
import {
  PRNG,
  beatsin88_t,
  beatsin8_t,
  constrain,
  cos8_t,
  cos_t,
  cubicwave8,
  get_random_wheel_index,
  hw_random,
  hw_random16,
  hw_random8,
  map,
  mul32,
  perlin16,
  perlin8,
  qadd8,
  qsub8,
  scale8,
  sin16_t,
  sin8_t,
  sin_t,
  triwave8,
  u16,
  u8,
} from "../math.js";
import type { Segment } from "../segment.js";
import { chase, mode_static, running } from "./basic.js";
import { SOLID_WRAP, type Registry } from "./common.js";

export const mode_chase_color = (s: Segment) =>
  chase(s, s.getCurrentColor(1), s.getCurrentColor(2) ? s.getCurrentColor(2) : s.getCurrentColor(0), s.getCurrentColor(0), true);
export const mode_chase_random = (s: Segment) =>
  chase(s, s.getCurrentColor(1), s.getCurrentColor(2) ? s.getCurrentColor(2) : s.getCurrentColor(0), s.getCurrentColor(0), false);

export function mode_chase_rainbow(s: Segment) {
  let colorSep = Math.floor(256 / s.vLength);
  if (colorSep === 0) colorSep = 1;
  const colorIndex = s.call & 0xff;
  const color = s.color_wheel((s.step * colorSep + colorIndex) & 0xff);
  chase(s, color, s.getCurrentColor(0), s.getCurrentColor(1), false);
}

export function mode_chase_rainbow_white(s: Segment) {
  const SEGLEN = s.vLength;
  const n = u16(s.step);
  const m = u16((s.step + 1) % SEGLEN);
  const color2 = s.color_wheel((Math.floor((n * 256) / SEGLEN) + (s.call & 0xff)) & 0xff);
  const color3 = s.color_wheel((Math.floor((m * 256) / SEGLEN) + (s.call & 0xff)) & 0xff);
  chase(s, s.getCurrentColor(0), color2, color3, false);
}

export function mode_colorful(s: Segment) {
  let numColors = 4;
  const cols = [0x00ff0000, 0x00eebb00, 0x0000ee00, 0x000077cc, 0, 0, 0, 0, 0];
  if (s.intensity > 160 || s.paletteId) {
    if (!s.paletteId) {
      numColors = 3;
      for (let i = 0; i < 3; i++) cols[i] = s.getCurrentColor(i);
    } else {
      let fac = 80;
      if (s.paletteId === 52) {
        numColors = 5;
        fac = 61;
      }
      for (let i = 0; i < numColors; i++) cols[i] = s.color_from_palette(i * fac, false, true, 255);
    }
  } else if (s.intensity < 80) {
    cols[0] = 0x00ff8040;
    cols[1] = 0x00e5d241;
    cols[2] = 0x0077ff77;
    cols[3] = 0x0077f0f0;
  }
  for (let i = numColors; i < numColors * 2 - 1; i++) cols[i] = cols[i - numColors]!;
  const cycleTime = 50 + 8 * (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  if (it !== s.step) {
    if (s.speed > 0) s.aux0++;
    if (s.aux0 >= numColors) s.aux0 = 0;
    s.step = it;
  }
  for (let i = 0; i < s.vLength; i += numColors) for (let j = 0; j < numColors; j++) s.setPixelColor(i + j, cols[s.aux0 + j]!);
}

export function mode_traffic_light(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 1));
  let mdelay = 500;
  for (let i = 0; i < SEGLEN - 2; i += 3) {
    switch (s.aux0) {
      case 0:
        s.setPixelColor(i, 0x00ff0000);
        mdelay = 150 + 100 * (255 - s.speed);
        break;
      case 1:
        s.setPixelColor(i, 0x00ff0000);
        mdelay = 150 + 20 * (255 - s.speed);
        s.setPixelColor(i + 1, 0x00eecc00);
        break;
      case 2:
        s.setPixelColor(i + 2, 0x0000ff00);
        mdelay = 150 + 100 * (255 - s.speed);
        break;
      case 3:
        s.setPixelColor(i + 1, gamma32inv(0x00eecc00));
        mdelay = 150 + 20 * (255 - s.speed);
        break;
    }
  }
  if ((s.now - s.step) >>> 0 > mdelay) {
    s.aux0++;
    if (s.aux0 === 1 && s.intensity > 140) s.aux0 = 2;
    if (s.aux0 > 3) s.aux0 = 0;
    s.step = s.now;
  }
}

const FLASH_COUNT = 4;
export function mode_chase_flash(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const now = s.now;
  let advance = true;
  const flashStep = s.aux1 % (FLASH_COUNT * 2 + 1);
  if (now < s.step) advance = false;
  else s.aux1++;
  for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  const n = s.aux0;
  const m = (n + 1) % SEGLEN;
  let delay = 10 + Math.floor((30 * (255 - s.speed)) / SEGLEN);
  if (flashStep < FLASH_COUNT * 2) {
    if (flashStep % 2 === 0) {
      s.setPixelColor(n, s.getCurrentColor(1));
      s.setPixelColor(m, s.getCurrentColor(1));
      delay = 20;
    } else delay = 30;
  } else if (advance) s.aux0 = m;
  if (advance) s.step = now + delay;
}

export function mode_chase_flash_random(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const now = s.now;
  let advance = true;
  if (now < s.step) {
    s.call--;
    advance = false;
  }
  const flashStep = s.call % (FLASH_COUNT * 2 + 1);
  for (let i = 0; i < s.aux1; i++) s.setPixelColor(i, s.color_wheel(s.aux0));
  let delay = 1 + Math.floor((10 * (255 - s.speed)) / SEGLEN);
  if (flashStep < FLASH_COUNT * 2) {
    const n = s.aux1;
    const m = (s.aux1 + 1) % SEGLEN;
    if (flashStep % 2 === 0) {
      s.setPixelColor(n, s.getCurrentColor(0));
      s.setPixelColor(m, s.getCurrentColor(0));
      delay = 20;
    } else {
      s.setPixelColor(n, s.color_wheel(s.aux0));
      s.setPixelColor(m, s.getCurrentColor(1));
      delay = 30;
    }
  } else if (advance) {
    s.aux1 = (s.aux1 + 1) % SEGLEN;
    if (s.aux1 === 0) s.aux0 = get_random_wheel_index(s.aux0);
  }
  if (advance) s.step = now + delay;
}

/** "Chase 2": alternating color/secondary blocks running. */
export const mode_running_color = (s: Segment) => running(s, s.getCurrentColor(0), s.getCurrentColor(1));

export function mode_running_random(s: Segment) {
  const cycleTime = 25 + 3 * (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  if (s.call === 0) s.aux0 = hw_random();
  const zoneSize = ((255 - s.intensity) >> 4) + 1;
  let prng16 = s.aux0;
  let z = it % zoneSize;
  let nzone = !z && (it & 0xffff) !== s.aux1;
  for (let i = s.vLength - 1; i >= 0; i--) {
    if (nzone || z >= zoneSize) {
      const lastrand = prng16 >> 8;
      let diff = 0;
      while (Math.abs(diff) < 42) {
        prng16 = u16(u16(prng16 * 2053) + 13849);
        diff = (prng16 >> 8) - lastrand;
      }
      if (nzone) {
        s.aux0 = prng16;
        nzone = false;
      }
      z = 0;
    }
    s.setPixelColor(i, s.color_wheel(prng16 >> 8));
    z++;
  }
  s.aux1 = it & 0xffff;
}

export function mode_larson_scanner(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const speed = s.frametime * map(s.speed, 0, 255, 96, 2);
  const pixels = Math.floor(SEGLEN / speed);
  s.fade_out(255 - s.intensity);
  if (s.step > s.now) return;
  let index = s.aux1 + pixels;
  if (pixels === 0) {
    const frames = Math.floor(speed / SEGLEN);
    const before = s.step;
    s.step++;
    if (before < frames) return;
    s.step = 0;
    index++;
  }
  if (index > SEGLEN) {
    s.aux0 = s.aux0 ? 0 : 1;
    s.aux1 = 0;
    if (s.aux0 || s.check2) s.step = s.now + s.custom1 * 25;
    else s.step = 0;
  } else {
    for (let i = s.aux1; i < index; i++) {
      const j = s.aux0 ? i : SEGLEN - 1 - i;
      const c = s.color_from_palette(j, true, SOLID_WRAP(s), 0);
      s.setPixelColor(j, c);
      if (s.check1) s.setPixelColor(SEGLEN - 1 - j, s.getCurrentColor(2) ? s.getCurrentColor(2) : c);
    }
    s.aux1 = index;
  }
}
export function mode_dual_larson_scanner(s: Segment) {
  s.check1 = true;
  mode_larson_scanner(s);
}

export function mode_comet(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const counter = mul32(s.now, (s.speed >> 2) + 1) & 0xffff;
  const index = Math.floor((counter * SEGLEN) / 65536);
  if (s.call === 0) s.aux0 = index;
  s.fade_out(s.intensity);
  s.setPixelColor(index, s.color_from_palette(index, true, SOLID_WRAP(s), 0));
  if (index > s.aux0) {
    for (let i = s.aux0; i < index; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  } else if (index < s.aux0 && index < 10) {
    for (let i = 0; i < index; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  }
  s.aux0 = index;
}

export function mode_fireworks(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const width = SEGLEN;
  const height = 1;
  if (s.call === 0) {
    s.aux0 = 0xffff;
    s.aux1 = 0xffff;
  }
  s.fade_out(128);
  if (!s.step) {
    const valid1 = s.aux0 < width * height;
    const valid2 = s.aux1 < width * height;
    const sv1 = valid1 ? s.getPixelColor(s.aux0) : 0;
    const sv2 = valid2 ? s.getPixelColor(s.aux1) : 0;
    s.blur(16);
    if (valid1) s.setPixelColor(s.aux0, sv1);
    if (valid2) s.setPixelColor(s.aux1, sv2);
  }
  for (let i = 0; i < Math.max(1, Math.floor(width / 20)); i++) {
    if (hw_random8(129 - (s.intensity >> 1)) === 0) {
      const index = hw_random16(width * height);
      s.setPixelColor(index, s.color_from_palette(hw_random8(), false, false, 0));
      s.aux1 = s.aux0;
      s.aux0 = index;
    }
  }
}

export function mode_rain(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.step += s.frametime;
  if (s.call && s.step > s.speedFormulaL) {
    s.step = 1;
    const ctemp = s.getPixelColor(0);
    for (let i = 0; i < SEGLEN - 1; i++) s.setPixelColor(i, s.getPixelColor(i + 1));
    s.setPixelColor(SEGLEN - 1, ctemp);
    s.aux0++;
    s.aux1++;
    if (s.aux0 === 0) s.aux0 = 0xffff;
    if (s.aux1 === 0) s.aux0 = 0xffff;
    if (s.aux0 >= SEGLEN) s.aux0 = 0;
    if (s.aux1 >= SEGLEN) s.aux1 = 0;
  }
  mode_fireworks(s);
}

export function mode_fire_flicker(s: Segment) {
  const cycleTime = 40 + (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  if (s.step === it) return;
  const c0 = s.getCurrentColor(0);
  const w = W(c0);
  const r = R(c0);
  const g = G(c0);
  const b = B(c0);
  let lum = s.paletteId === 0 ? Math.max(w, r, g, b) : 255;
  lum = Math.floor(lum / (Math.floor((256 - s.intensity) / 16) + 1));
  for (let i = 0; i < s.vLength; i++) {
    const flicker = hw_random8(lum);
    if (s.paletteId === 0) s.setPixelColor(i, RGBW32(Math.max(r - flicker, 0), Math.max(g - flicker, 0), Math.max(b - flicker, 0), Math.max(w - flicker, 0)));
    else s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0, 255 - flicker));
  }
  s.step = it;
}

function gradient_base(s: Segment, loading: boolean) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const counter = u16(mul32(s.now, (s.speed >> 2) + 1));
  let pp = u16(Math.floor((counter * SEGLEN) / 65536));
  if (s.call === 0) pp = 0;
  // `1 + loading ? a : b` parses as `(1 + loading) ? a : b` in WLED, so the spread is always intensity/2.
  const brd = Math.floor(s.intensity / 2);
  const p1 = pp - SEGLEN;
  const p2 = pp + SEGLEN;
  for (let i = 0; i < SEGLEN; i++) {
    let val = loading ? Math.abs((i > pp ? p2 : pp) - i) : Math.min(Math.abs(pp - i), Math.min(Math.abs(p1 - i), Math.abs(p2 - i)));
    val = brd > val ? Math.trunc((val * 255) / brd) : 255;
    s.setPixelColor(i, color_blend(s.getCurrentColor(0), s.color_from_palette(i, true, SOLID_WRAP(s), 1), u8(val)));
  }
}
export const mode_gradient = (s: Segment) => gradient_base(s, false);
export const mode_loading = (s: Segment) => gradient_base(s, true);

export function mode_two_dots(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const delay = 1 + Math.floor((s.frametime << 3) / SEGLEN);
  const it = Math.floor(s.now / map(s.speed, 0, 255, delay << 4, delay));
  const offset = it % SEGLEN;
  let width = (SEGLEN * (s.intensity + 1)) >> 9;
  if (!width) width = 1;
  if (!s.check2) s.fill(s.getCurrentColor(2));
  const color1 = s.getCurrentColor(0);
  const color2 = s.getCurrentColor(1) === s.getCurrentColor(2) ? color1 : s.getCurrentColor(1);
  for (let i = 0; i < width; i++) {
    s.setPixelColor((offset + i) % SEGLEN, color1);
    s.setPixelColor((offset + i + (SEGLEN >> 1)) % SEGLEN, color2);
  }
}

/** Flasher struct (4 bytes): uint16 stateStart, uint8 stateDur, bool stateOn. */
class Flashers {
  private v: DataView;
  constructor(data: Uint8Array) {
    this.v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  start(f: number) { return this.v.getUint16(f * 4, true); }
  setStart(f: number, x: number) { this.v.setUint16(f * 4, x & 0xffff, true); }
  dur(f: number) { return this.v.getUint8(f * 4 + 2); }
  setDur(f: number, x: number) { this.v.setUint8(f * 4 + 2, x & 0xff); }
  on(f: number) { return this.v.getUint8(f * 4 + 3) !== 0; }
  setOn(f: number, x: boolean) { this.v.setUint8(f * 4 + 3, x ? 1 : 0); }
}

const FLASHERS_PER_ZONE = 6;
const MAX_SHIMMER = 92;
export function mode_fairy(s: Segment) {
  const SEGLEN = s.vLength;
  let prng16 = u16(5100 + s.strip.segments.indexOf(s));
  for (let i = 0; i < SEGLEN; i++) {
    prng16 = u16(u16(prng16 * 2053) + 1384);
    s.setPixelColor(i, s.color_from_palette(prng16 >> 8, false, false, 0));
  }
  if (s.intensity === 0) return;
  const flasherDistance = Math.floor((255 - s.intensity) / 28) + 1;
  const numFlashers = Math.floor(SEGLEN / flasherDistance) + 1;
  s.allocateData(4 * numFlashers);
  const fl = new Flashers(s.data);
  const now16 = s.now & 0xffff;
  let zones = Math.floor(numFlashers / FLASHERS_PER_ZONE);
  if (!zones) zones = 1;
  let flashersInZone = Math.floor(numFlashers / zones);
  const flasherBri = new Uint8Array(FLASHERS_PER_ZONE * 2 - 1 + numFlashers);
  for (let z = 0; z < zones; z++) {
    let briSum = 0;
    const first = z * flashersInZone;
    if (z === zones - 1) flashersInZone = numFlashers - flashersInZone * (zones - 1);
    for (let f = first; f < first + flashersInZone; f++) {
      let stateTime = u16(now16 - fl.start(f));
      if (stateTime > fl.dur(f) * 10) {
        fl.setOn(f, !fl.on(f));
        if (fl.on(f)) fl.setDur(f, 12 + hw_random8(12 + ((255 - s.speed) >> 2)));
        else fl.setDur(f, 20 + hw_random8(6 + ((255 - s.speed) >> 2)));
        fl.setStart(f, now16);
        if (stateTime < 255) {
          fl.setStart(f, fl.start(f) - (255 - stateTime));
          fl.setDur(f, fl.dur(f) + 26 - Math.floor(stateTime / 10));
          stateTime = 255 - stateTime;
        } else stateTime = 0;
      }
      if (stateTime > 255) stateTime = 255;
      flasherBri[f - first] = fl.on(f) ? stateTime : 255 - stateTime;
      briSum += flasherBri[f - first]!;
    }
    const avg = Math.floor(briSum / flashersInZone);
    const globalPeakBri = 255 - ((avg * MAX_SHIMMER) >> 8);
    for (let f = first; f < first + flashersInZone; f++) {
      const bri = u8(Math.floor((flasherBri[f - first]! * globalPeakBri) / 255));
      prng16 = u16(u16(prng16 * 2053) + 1384);
      const pos = f * flasherDistance;
      s.setPixelColor(pos, color_blend(s.getCurrentColor(1), s.color_from_palette(prng16 >> 8, false, false, 0), bri));
      for (let i = pos + 1; i < pos + flasherDistance && i < SEGLEN; i++) {
        prng16 = u16(u16(prng16 * 2053) + 1384);
        s.setPixelColor(i, s.color_from_palette(prng16 >> 8, false, false, 0, globalPeakBri));
      }
    }
  }
}

export function mode_fairytwinkle(s: Segment) {
  const SEGLEN = s.vLength;
  s.allocateData(4 * SEGLEN);
  const fl = new Flashers(s.data);
  const now16 = s.now & 0xffff;
  let prng16 = u16(5100 + s.strip.segments.indexOf(s));
  const riseFallTime = 400 + (255 - s.speed) * 3;
  const maxDur = Math.floor(riseFallTime / 100) + ((255 - s.intensity) >> 2) + 13 + ((255 - s.intensity) >> 1);
  for (let f = 0; f < SEGLEN; f++) {
    let stateTime = u16(now16 - fl.start(f));
    if (stateTime > fl.dur(f) * 100) {
      fl.setOn(f, !fl.on(f));
      const init = !fl.dur(f);
      if (fl.on(f)) fl.setDur(f, Math.floor(riseFallTime / 100) + ((255 - s.intensity) >> 2) + hw_random8(12 + ((255 - s.intensity) >> 1)) + 1);
      else fl.setDur(f, Math.floor(riseFallTime / 100) + hw_random8(3 + ((255 - s.speed) >> 6)) + 1);
      fl.setStart(f, now16);
      stateTime = 0;
      if (init) {
        fl.setStart(f, fl.start(f) - riseFallTime);
        fl.setDur(f, Math.floor(riseFallTime / 100) + hw_random8(12 + ((255 - s.intensity) >> 1)) + 5);
        stateTime = riseFallTime;
      }
    }
    if (fl.on(f) && fl.dur(f) > maxDur) fl.setDur(f, maxDur);
    if (stateTime > riseFallTime) stateTime = riseFallTime;
    const fadeprog = 255 - Math.floor((stateTime * 255) / riseFallTime);
    const bri = fl.on(f) ? 255 - gamma8(fadeprog) : gamma8(fadeprog);
    const lastR = prng16;
    let diff = 0;
    while (diff < 0x4000) {
      prng16 = u16(u16(prng16 * 2053) + 1384);
      diff = prng16 > lastR ? prng16 - lastR : lastR - prng16;
    }
    s.setPixelColor(f, color_blend(s.getCurrentColor(1), s.color_from_palette(prng16 >> 8, false, false, 0), bri));
  }
}

function tricolor_chase(s: Segment, color1: number, color2: number) {
  const SEGLEN = s.vLength;
  const cycleTime = 50 + ((255 - s.speed) << 1);
  const it = Math.floor(s.now / cycleTime);
  const width = 1 + (s.intensity >> 4);
  let index = it % (width * 3);
  for (let i = 0; i < SEGLEN; i++, index++) {
    if (index > width * 3 - 1) index = 0;
    let color = color1;
    if (index > (width << 1) - 1) color = s.color_from_palette(i, true, SOLID_WRAP(s), 1);
    else if (index > width - 1) color = color2;
    s.setPixelColor(SEGLEN - i - 1, color);
  }
}
export const mode_tricolor_chase = (s: Segment) => tricolor_chase(s, s.getCurrentColor(2), s.getCurrentColor(0));

export function mode_icu(s: Segment) {
  const SEGLEN = s.vLength;
  const now = s.now & 0xffff;
  let dest = s.aux1;
  const space = (s.intensity >> 3) + 2;
  let state = s.step >>> 16;
  let nextUpdate = s.step & 0xffff;
  const pindex = u8(map(dest, 0, SEGLEN - Math.floor(SEGLEN / space), 0, 255));
  const col = s.color_from_palette(pindex, false, false, 0);
  s.fill(s.check2 ? 0 : s.getCurrentColor(1));
  const gap = Math.floor(SEGLEN / space);
  if (state !== 1) {
    s.setPixelColor(dest, col);
    s.setPixelColor(dest + gap, col);
    if (state === 3) {
      if (s.aux0 > s.aux1) dest++;
      else if (s.aux0 < s.aux1) dest--;
      s.setPixelColor(dest, col);
      s.setPixelColor(dest + gap, col);
    }
  }
  if (((now - nextUpdate) << 16) >> 16 >= 0) {
    switch (state) {
      case 0:
        state++;
        if (hw_random8(6) === 0) {
          nextUpdate = u16(now + 200);
          break;
        }
      // falls through
      case 1:
        nextUpdate = u16(now + 500 + hw_random16(1000));
        state++;
        break;
      case 2:
        s.aux0 = hw_random16(SEGLEN - gap);
        nextUpdate = now;
        state++;
        break;
      default:
        s.aux1 = dest;
        nextUpdate = u16(now + s.speedFormulaL);
        if (s.aux0 === dest) {
          nextUpdate = u16(now + 500 + hw_random16(1000));
          state = 0;
        }
    }
  }
  s.step = ((state << 16) | nextUpdate) >>> 0;
}

export function mode_tricolor_wipe(s: Segment) {
  const SEGLEN = s.vLength;
  const cycleTime = 1000 + (255 - s.speed) * 200;
  const perc = s.now % cycleTime;
  const prog = Math.floor((perc * 65535) / cycleTime);
  const ledIndex = Math.floor((prog * SEGLEN * 3) / 65536);
  let ledOffset = ledIndex;
  for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 2));
  if (ledIndex < SEGLEN) {
    for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, i > ledOffset ? s.getCurrentColor(0) : s.getCurrentColor(1));
  } else if (ledIndex < SEGLEN * 2) {
    ledOffset = ledIndex - SEGLEN;
    for (let i = ledOffset + 1; i < SEGLEN; i++) s.setPixelColor(i, s.getCurrentColor(1));
  } else {
    ledOffset = ledIndex - SEGLEN * 2;
    for (let i = 0; i <= ledOffset; i++) s.setPixelColor(i, s.getCurrentColor(0));
  }
}

export function mode_tricolor_fade(s: Segment) {
  const counter = u16(mul32(s.now, (s.speed >> 3) + 1));
  const prog = (counter * 768) >>> 16;
  let color1: number, color2: number, stage: number;
  if (prog < 256) [color1, color2, stage] = [s.getCurrentColor(0), s.getCurrentColor(1), 0];
  else if (prog < 512) [color1, color2, stage] = [s.getCurrentColor(1), s.getCurrentColor(2), 1];
  else [color1, color2, stage] = [s.getCurrentColor(2), s.getCurrentColor(0), 2];
  const stp = prog & 0xff;
  for (let i = 0; i < s.vLength; i++) {
    let color: number;
    if (stage === 2) color = color_blend(s.color_from_palette(i, true, SOLID_WRAP(s), 2), color2, stp);
    else if (stage === 1) color = color_blend(color1, s.color_from_palette(i, true, SOLID_WRAP(s), 2), stp);
    else color = color_blend(color1, color2, stp);
    s.setPixelColor(i, color);
  }
}

const MAX_COMETS = 8;
export function mode_multi_comet(s: Segment) {
  const SEGLEN = s.vLength;
  const cycleTime = 10 + (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  if (s.step === it) return;
  s.allocateData(2 * MAX_COMETS);
  s.fade_out(Math.floor(s.intensity / 2) + 128);
  const comets = new Uint16Array(s.data.buffer, 0, MAX_COMETS);
  for (let i = 0; i < MAX_COMETS; i++) {
    if (comets[i]! < SEGLEN) {
      const index = comets[i]!;
      if (s.getCurrentColor(2) !== 0) s.setPixelColor(index, i % 2 ? s.color_from_palette(index, true, SOLID_WRAP(s), 0) : s.getCurrentColor(2));
      else s.setPixelColor(index, s.color_from_palette(index, true, SOLID_WRAP(s), 0));
      comets[i] = comets[i]! + 1;
    } else if (!hw_random16(SEGLEN)) comets[i] = 0;
  }
  s.step = it;
}

/** The effects' shared seeded PRNG ("prng" in FX.cpp). */
const prng = new PRNG(hw_random() & 0xffff);

export function mode_random_chase(s: Segment) {
  const SEGLEN = s.vLength;
  if (s.call === 0) {
    s.step = RGBW32(prng.random8(), prng.random8(), prng.random8(), 0);
    s.aux0 = prng.random16();
  }
  const prevSeed = prng.getSeed();
  const cycleTime = 25 + 3 * (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  let color = s.step;
  prng.setSeed(s.aux0);
  for (let i = SEGLEN - 1; i >= 0; i--) {
    const r = prng.random8(6) !== 0 ? (color >>> 16) & 0xff : prng.random8();
    const g = prng.random8(6) !== 0 ? (color >>> 8) & 0xff : prng.random8();
    const b = prng.random8(6) !== 0 ? color & 0xff : prng.random8();
    color = RGBW32(r, g, b, 0);
    s.setPixelColor(i, color);
    if (i === SEGLEN - 1 && s.aux1 !== (it & 0xffff)) {
      s.step = color;
      s.aux0 = prng.getSeed();
    }
  }
  s.aux1 = it & 0xffff;
  prng.setSeed(prevSeed);
}

export function mode_oscillate(s: Segment) {
  const SEGLEN = s.vLength;
  type Osc = { pos: number; size: number; dir: number; speed: number };
  if (s.call === 0 || !s.state) {
    s.state = [
      { pos: u16(Math.floor(SEGLEN / 4)), size: u8(Math.floor(SEGLEN / 8)), dir: 1, speed: 1 },
      { pos: u16(Math.floor(SEGLEN / 4) * 3), size: u8(Math.floor(SEGLEN / 8)), dir: 1, speed: 2 },
      { pos: u16(Math.floor(SEGLEN / 4) * 2), size: u8(Math.floor(SEGLEN / 8)), dir: -1, speed: 1 },
    ] satisfies Osc[];
  }
  const osc = s.state as Osc[];
  const cycleTime = 20 + 2 * (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  for (const o of osc) {
    if (it !== s.step) o.pos = u16(o.pos + o.dir * o.speed);
    o.size = u8(Math.floor(SEGLEN / (3 + Math.floor(s.intensity / 8))));
    if (o.dir === -1 && o.pos > SEGLEN << 1) {
      o.pos = 0;
      o.dir = 1;
      o.speed = s.speed > 100 ? hw_random8(2, 4) : hw_random8(1, 3);
    }
    if (o.dir === 1 && o.pos >= SEGLEN - 1) {
      o.pos = SEGLEN - 1;
      o.dir = -1;
      o.speed = s.speed > 100 ? hw_random8(2, 4) : hw_random8(1, 3);
    }
  }
  for (let i = 0; i < SEGLEN; i++) {
    let color = 0;
    for (let j = 0; j < osc.length; j++) {
      const o = osc[j]!;
      if (i >= o.pos - o.size && i <= o.pos + o.size) color = color === 0 ? s.getCurrentColor(j) : color_blend(color, s.getCurrentColor(j), 128);
    }
    s.setPixelColor(i, color);
  }
  s.step = it;
}

export function mode_lightning(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const ledstart = hw_random16(SEGLEN);
  const ledlen = 1 + hw_random16(SEGLEN - ledstart);
  let bri = u8(Math.floor(255 / hw_random8(1, 3)));
  if (s.aux1 === 0) {
    s.aux1 = hw_random8(4, 4 + Math.floor(s.intensity / 20));
    s.aux1 *= 2;
    bri = 52;
    s.aux0 = 200;
  }
  if (!s.check2) s.fill(s.getCurrentColor(1));
  if (s.aux1 > 3 && !(s.aux1 & 1)) {
    for (let i = ledstart; i < ledstart + ledlen; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0, bri));
    s.aux1--;
    s.step = s.now;
  } else if ((s.now - s.step) >>> 0 > s.aux0) {
    s.aux1--;
    if (s.aux1 < 2) s.aux1 = 0;
    s.aux0 = 50 + hw_random8(100);
    if (s.aux1 === 2) s.aux0 = hw_random8(255 - s.speed) * 100;
    s.step = s.now;
  }
}

function colorwaves_pride_base(s: Segment, isPride2015: boolean) {
  const SEGLEN = s.vLength;
  const duration = 10 + s.speed;
  let sPseudotime = s.step;
  let sHue16 = s.aux0;
  const sat8 = isPride2015 ? u8(beatsin88_t(87, 220, 250)) : 255;
  const brightdepth = beatsin88_t(341, 96, 224);
  const brightnessthetainc16 = beatsin88_t(203, 25 * 256, 40 * 256);
  const msmultiplier = beatsin88_t(147, 23, 60);
  let hue16 = sHue16;
  const hueinc16 = isPride2015 ? beatsin88_t(113, 1, 3000) : Math.floor((beatsin88_t(113, 60, 300) * s.intensity * 10) / 255);
  sPseudotime = (sPseudotime + duration * msmultiplier) >>> 0;
  sHue16 = (sHue16 + duration * beatsin88_t(400, 5, 9)) >>> 0;
  let brightnesstheta16 = sPseudotime;
  for (let i = 0; i < SEGLEN; i++) {
    hue16 = (hue16 + hueinc16) >>> 0;
    let hue8: number;
    if (isPride2015) hue8 = (hue16 >>> 8) & 0xff;
    else {
      const h16_128 = hue16 >>> 7;
      hue8 = (h16_128 & 0x100 ? 255 - (h16_128 >>> 1) : h16_128 >>> 1) & 0xff;
    }
    brightnesstheta16 = (brightnesstheta16 + brightnessthetainc16) >>> 0;
    const b16 = (sin16_t(brightnesstheta16) + 32768) >>> 0;
    const bri16 = Math.floor((b16 * b16) / 65536);
    let bri8 = u8(Math.floor((bri16 * brightdepth) / 65536));
    bri8 = u8(bri8 + (255 - brightdepth));
    if (isPride2015) s.blendPixelColor(i, gamma32inv(CHSV(hue8, sat8, bri8)), 64);
    else s.blendPixelColor(i, s.color_from_palette(hue8, false, SOLID_WRAP(s), 0, bri8), 128);
  }
  s.step = sPseudotime;
  s.aux0 = sHue16;
}
export const mode_pride_2015 = (s: Segment) => colorwaves_pride_base(s, true);
export const mode_colorwaves = (s: Segment) => colorwaves_pride_base(s, false);

export function mode_juggle(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.fadeToBlackBy(192 - Math.floor((3 * s.intensity) / 4));
  let dothue = 0;
  for (let i = 0; i < 8; i++) {
    const index = beatsin88_t((16 + s.speed) * (i + 7), 0, SEGLEN - 1);
    const cur = s.getPixelColor(index) & 0xffffff;
    const add = s.paletteId === 0 ? CHSV(dothue, 220, 255) : ColorFromPalette(s.currentPalette, dothue, 255);
    s.setPixelColor(index, RGBW32(Math.max(R(cur), R(add)), Math.max(G(cur), G(add)), Math.max(B(cur), B(add))));
    dothue = u8(dothue + 32);
  }
}

export function mode_palette(s: Segment) {
  const cols = s.vLength;
  const segs = s.strip.segments.filter((x) => x.isActive);
  const rows = segs.length;
  const inputShift = s.speed;
  const inputSize = s.intensity;
  const inputRotation = s.custom1;
  const animateShift = s.check1;
  const animateRotation = s.check2;
  const assumeSquare = s.check3;
  const maxAngle = Math.PI / 256;
  const theta = !animateRotation
    ? (inputRotation + 128) * maxAngle
    : (mul32(s.now, (inputRotation >> 4) + 1) & 0xffff) * ((2 * Math.PI) / 0xffff);
  const sinTheta = sin_t(theta);
  const cosTheta = cos_t(theta);
  const maxX = Math.max(1, cols - 1);
  const maxY = Math.max(1, rows - 1);
  const maxXIn = assumeSquare ? maxX : 1;
  const maxYIn = assumeSquare ? maxY : 1;
  const maxXOut = !assumeSquare ? maxX : 1;
  const maxYOut = !assumeSquare ? maxY : 1;
  const centerX = maxXOut / 2;
  const centerY = maxYOut / 2;
  const scale = Math.abs(sinTheta) + (Math.abs(cosTheta) * maxYOut) / maxXOut;
  const y = Math.max(0, s.strip.segments.indexOf(s));
  const ytCosTheta = (cosTheta * (y - centerY * maxYIn)) / (maxYIn * scale);
  const paletteOffset = !animateShift ? inputShift : (mul32(s.now, (inputShift >> 3) + 1) & 0xffff) >> 8;
  for (let x = 0; x < cols; x++) {
    const xtSinTheta = (sinTheta * (x - centerX * maxXIn)) / (maxXIn * scale);
    const sourceX = xtSinTheta + ytCosTheta + centerX;
    let colorIndex = Math.trunc((Math.min(Math.max(sourceX, 0), maxXOut) * 255) / maxXOut);
    if (inputSize <= 128) colorIndex = Math.trunc((colorIndex * inputSize) / 128);
    else colorIndex = Math.trunc(((inputSize - 112) * colorIndex) / 16);
    colorIndex -= paletteOffset;
    s.setPixelColor(x, s.color_wheel(colorIndex & 0xff));
  }
}

export function mode_fire_2012(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.allocateData(SEGLEN);
  const heat = s.data;
  const it = s.now >>> 5;
  const ignition = Math.max(3, Math.floor(SEGLEN / 10)) & 0xff;
  for (let i = 0; i < SEGLEN; i++) {
    const cool = it !== s.step ? hw_random8(Math.floor(((20 + Math.floor(s.speed / 3)) * 16) / SEGLEN) + 2) : hw_random8(4);
    const minTemp = i < ignition ? Math.floor((ignition - i) / 4) + 16 : 0;
    const temp = qsub8(heat[i]!, cool);
    heat[i] = temp < minTemp ? minTemp : temp;
  }
  if (it !== s.step) {
    for (let k = SEGLEN - 1; k > 1; k--) heat[k] = Math.floor((heat[k - 1]! + (heat[k - 2]! << 1)) / 3);
    if (hw_random8() <= s.intensity) {
      const y = hw_random8(ignition);
      const boost = u8(Math.floor(((17 + s.custom3) * (ignition - (y >> 1))) / ignition));
      heat[y] = qadd8(heat[y]!, hw_random8(96 + 2 * boost, 207 + boost));
    }
  }
  for (let j = 0; j < SEGLEN; j++) s.setPixelColor(j, ColorFromPalette(s.currentPalette, Math.min(heat[j]!, 240), 255, NOBLEND));
  if (it !== s.step) s.step = it;
}

export function mode_bpm(s: Segment) {
  const stp = Math.floor(s.now / 20) & 0xff;
  const beat = beatsin8_t(s.speed, 64, 255);
  for (let i = 0; i < s.vLength; i++)
    s.setPixelColor(i, s.color_from_palette(u16(stp + i * 2), false, SOLID_WRAP(s), 0, u8(beat - stp + i * 10)));
}

export function mode_fillnoise8(s: Segment) {
  const SEGLEN = s.vLength;
  if (s.call === 0) s.step = hw_random();
  for (let i = 0; i < SEGLEN; i++) {
    const index = perlin8(i * SEGLEN, s.step + i * SEGLEN);
    s.setPixelColor(i, s.color_from_palette(index, false, SOLID_WRAP(s), 0));
  }
  s.step += beatsin8_t(s.speed, 1, 6);
}

export function mode_noise16_1(s: Segment) {
  const scale = 320;
  s.step += 1 + Math.floor(s.speed / 16);
  for (let i = 0; i < s.vLength; i++) {
    const shiftX = beatsin8_t(11);
    const shiftY = Math.floor(s.step / 42);
    const noise = perlin16((i + shiftX) * scale, (i + shiftY) * scale, s.step) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t(noise * 3), false, SOLID_WRAP(s), 0));
  }
}
export function mode_noise16_2(s: Segment) {
  const scale = 1000;
  s.step += 1 + (s.speed >> 1);
  for (let i = 0; i < s.vLength; i++) {
    const shiftX = s.step >>> 6;
    const noise = perlin16((i + shiftX) * scale, 0, 4223) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t(noise * 3), false, SOLID_WRAP(s), 0, noise));
  }
}
export function mode_noise16_3(s: Segment) {
  const scale = 800;
  s.step += 1 + s.speed;
  for (let i = 0; i < s.vLength; i++) {
    const noise = perlin16((i + 4223) * scale, (i + 1234) * scale, mul32(s.step, 8)) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t(noise * 3), false, SOLID_WRAP(s), 0, noise));
  }
}
export function mode_noise16_4(s: Segment) {
  const stp = mul32(s.now, s.speed) >>> 7;
  for (let i = 0; i < s.vLength; i++) {
    const index = perlin16(i << 12, stp);
    s.setPixelColor(i, s.color_from_palette(index, false, SOLID_WRAP(s), 0));
  }
}

export function mode_colortwinkle(s: Segment) {
  const SEGLEN = s.vLength;
  s.allocateData((SEGLEN + 7) >> 3);
  if ((s.now - s.step) >>> 0 < 23) return;
  s.step = s.now;
  const bri = s.strip.brightness;
  const fadeUpAmount = bri > 28 ? 8 + (s.speed >> 2) : 68 - bri;
  const fadeDownAmount = bri > 28 ? 8 + (s.speed >> 3) : 68 - bri;
  const d = s.data;
  for (let i = 0; i < SEGLEN; i++) {
    const cur = s.getPixelColor(i);
    const index = i >> 3;
    const bit = 1 << (i & 7);
    if (d[index]! & bit) {
      let col = color_add(cur, color_fade(cur, fadeUpAmount, true));
      if (R(col) === 255 || G(col) === 255 || B(col) === 255) d[index] = d[index]! & ~bit;
      if (col === cur) col = color_add(col, col);
      s.setPixelColor(i, col);
    } else s.setPixelColor(i, color_fade(cur, 255 - fadeDownAmount, false));
  }
  for (let j = 0; j <= Math.floor(SEGLEN / 50); j++) {
    if (hw_random8() <= s.intensity) {
      for (let times = 0; times < 5; times++) {
        const i = hw_random16(SEGLEN);
        if (s.getPixelColor(i) === 0) {
          d[i >> 3] = d[i >> 3]! | (1 << (i & 7));
          s.setPixelColor(i, ColorFromPalette(s.currentPalette, hw_random8(), gamma8inv(64), NOBLEND));
          break;
        }
      }
    }
  }
}

export function mode_lake(s: Segment) {
  const sp = Math.floor(s.speed / 10);
  // WLED passes -64 as a uint8 lowest value; the waves wrap, which cos8/cubicwave8 absorb.
  const wave1 = beatsin8_t(sp + 2, -64 & 0xff, 64);
  const wave2 = beatsin8_t(sp + 1, -64 & 0xff, 64);
  const wave3 = beatsin8_t(sp + 2, 0, 80);
  for (let i = 0; i < s.vLength; i++) {
    const index = Math.floor(cos8_t(i * 15 + wave1) / 2) + Math.floor(cubicwave8(i * 23 + wave2) / 2);
    const lum = index > wave3 ? index - wave3 : 0;
    s.setPixelColor(i, s.color_from_palette(index, false, false, 0, lum));
  }
}

export function mode_meteor(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.allocateData(SEGLEN);
  const smooth = s.check3;
  const trail = s.data;
  const meteorSize = 1 + Math.floor(SEGLEN / 20);
  let meteorstart: number;
  if (smooth) meteorstart = u16(map((s.step >>> 6) & 0xff, 0, 255, 0, SEGLEN - 1));
  else {
    const counter = mul32(s.now, (s.speed >> 2) + 8);
    meteorstart = u16(Math.floor((counter * SEGLEN) / 65536));
  }
  const max = s.paletteId === 5 || !s.check1 ? 240 : 255;
  for (let i = 0; i < SEGLEN; i++) {
    if (hw_random8() <= 255 - s.intensity) {
      let col: number;
      if (smooth) {
        if (trail[i]! > 0) trail[i] = constrain(trail[i]! + 4 - hw_random8(24), 0, max);
        col = s.check1 ? s.color_from_palette(i, true, false, 0, trail[i]) : s.color_from_palette(trail[i]!, false, true, 255);
      } else {
        trail[i] = scale8(trail[i]!, 128 + hw_random8(127));
        let index = trail[i]!;
        let idx = 255;
        let bri = s.paletteId === 35 || s.paletteId === 36 ? 255 : trail[i]!;
        if (!s.check1) {
          idx = 0;
          index = map(i, 0, SEGLEN, 0, max);
          bri = trail[i]!;
        }
        col = s.color_from_palette(index, false, false, idx, bri);
      }
      s.setPixelColor(i, col);
    }
  }
  for (let j = 0; j < meteorSize; j++) {
    const index = (meteorstart + j) % SEGLEN;
    if (smooth) {
      trail[index] = max;
      s.setPixelColor(index, s.check1 ? s.color_from_palette(index, true, false, 0, trail[index]) : s.color_from_palette(trail[index]!, false, true, 255));
    } else {
      let idx = 255;
      trail[index] = max;
      let i = max;
      if (!s.check1) {
        i = map(index, 0, SEGLEN, 0, max);
        idx = 0;
      }
      s.setPixelColor(index, s.color_from_palette(i, false, false, idx, 255));
    }
  }
  s.step += s.speed + 1;
}

export function mode_railway(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const dur = (256 - s.speed) * 40;
  const rampdur = u16((dur * s.intensity) >> 8);
  if (s.step > dur) {
    s.step = 0;
    s.aux0 = s.aux0 ? 0 : 1;
  }
  let pos = 255;
  if (rampdur !== 0) {
    const p0 = Math.floor((s.step * 255) / rampdur);
    if (p0 < 255) pos = p0;
  }
  if (s.aux0) pos = 255 - pos;
  for (let i = 0; i < SEGLEN; i += 2) {
    s.setPixelColor(i, s.color_from_palette(255 - pos, false, false, 255));
    if (i < SEGLEN - 1) s.setPixelColor(i + 1, s.color_from_palette(pos, false, false, 255));
  }
  s.step += s.frametime;
}

const MAX_RIPPLES = 100;
const IBN = 5100;
/** Ripple struct (4 bytes): uint8 state, uint8 color, uint16 pos. */
export function ripple_base(s: Segment, blurAmount = 0) {
  const SEGLEN = s.vLength;
  const maxRipples = Math.min(1 + (SEGLEN >> 2), MAX_RIPPLES);
  s.allocateData(4 * maxRipples);
  const v = new DataView(s.data.buffer, 0, 4 * maxRipples);
  for (let i = 0; i < maxRipples; i++) {
    let ripplestate = v.getUint8(i * 4);
    if (ripplestate) {
      const rippledecay = (s.speed >> 4) + 1;
      const rippleorigin = v.getUint16(i * 4 + 2, true);
      const col = s.color_from_palette(v.getUint8(i * 4 + 1), false, false, 255);
      const propagation = ((Math.floor(ripplestate / rippledecay) - 1) * (s.speed + 1)) >>> 0;
      const propI = propagation >>> 8;
      const propF = propagation & 0xff;
      const amp = ripplestate < 17 ? triwave8((ripplestate - 1) * 8) : map(ripplestate, 17, 255, 255, 2);
      const left = rippleorigin - propI - 1;
      const right = rippleorigin + propI + 2;
      for (let k = 0; k < 4; k++) {
        const mag = scale8(cubicwave8((propF >> 2) + k * 64), amp);
        s.setPixelColor(left + k, color_blend(s.getPixelColor(left + k), col, mag));
        s.setPixelColor(right - k, color_blend(s.getPixelColor(right - k), col, mag));
      }
      ripplestate += rippledecay;
      v.setUint8(i * 4, ripplestate > 254 ? 0 : ripplestate);
    } else if (hw_random16(IBN + 10000) <= s.intensity) {
      v.setUint8(i * 4, 1);
      v.setUint16(i * 4 + 2, hw_random16(SEGLEN), true);
      v.setUint8(i * 4 + 1, hw_random8());
    }
  }
  s.blur(blurAmount);
}

export function mode_ripple(s: Segment) {
  if (s.vLength <= 1) return mode_static(s);
  if (s.custom1 || s.check2) s.fade_out(250);
  else s.fill(s.getCurrentColor(1));
  ripple_base(s, s.custom1 >> 1);
}

export const classicEffects: Registry = {
  28: mode_chase_color,
  29: mode_chase_random,
  30: mode_chase_rainbow,
  31: mode_chase_flash,
  32: mode_chase_flash_random,
  33: mode_chase_rainbow_white,
  34: mode_colorful,
  35: mode_traffic_light,
  37: mode_running_color,
  39: mode_running_random,
  40: mode_larson_scanner,
  41: mode_comet,
  42: mode_fireworks,
  43: mode_rain,
  45: mode_fire_flicker,
  46: mode_gradient,
  47: mode_loading,
  49: mode_fairy,
  50: mode_two_dots,
  51: mode_fairytwinkle,
  54: mode_tricolor_chase,
  55: mode_tricolor_wipe,
  56: mode_tricolor_fade,
  57: mode_lightning,
  58: mode_icu,
  59: mode_multi_comet,
  60: mode_dual_larson_scanner,
  61: mode_random_chase,
  62: mode_oscillate,
  63: mode_pride_2015,
  64: mode_juggle,
  65: mode_palette,
  66: mode_fire_2012,
  67: mode_colorwaves,
  68: mode_bpm,
  69: mode_fillnoise8,
  70: mode_noise16_1,
  71: mode_noise16_2,
  72: mode_noise16_3,
  73: mode_noise16_4,
  74: mode_colortwinkle,
  75: mode_lake,
  76: mode_meteor,
  78: mode_railway,
  79: mode_ripple,
};
