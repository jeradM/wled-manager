/**
 * WLED effects ported from FX.cpp (WLED main): Solid through Chase. Each keeps the original's integer math.
 */
import { color_blend, hsv2rgb_spectrum, rgb2hsv, W, WHITE } from "../color.js";
import { get_random_wheel_index, hw_random, hw_random8, hw_random16, map, mul32, sin16_t, sin8_t, triwave16, u16, u8 } from "../math.js";
import type { Segment } from "../segment.js";
import { SOLID_WRAP, sin_gap, type Registry } from "./common.js";

export function mode_static(s: Segment) {
  s.fill(s.getCurrentColor(0));
}

export function mode_copy_segment(s: Segment) {
  const sourceid = s.custom3;
  const segs = s.strip.segments;
  const me = segs.indexOf(s);
  if (sourceid >= segs.length || sourceid === me) s.fadeToBlackBy(5);
  const src = segs[sourceid];
  if (!src || !src.isActive) return;
  for (let i = 0; i < s.vLength; i++) {
    const color = s.check2 ? s.strip.pixels[i + src.start] ?? 0 : src.getPixelColor(i);
    s.setPixelColor(i, adjustColor(color, s.intensity, s.custom1, s.custom2));
  }
}

/** adjust_color(): hue shift, saturation and value change in HSV space. */
function adjustColor(c: number, hueShift: number, satChange: number, valueChange: number): number {
  if ((c & 0xffffff) === 0 && valueChange <= 0) return c;
  let [h, sat, v] = rgb2hsv(c);
  h = (h + (hueShift << 8)) & 0xffff;
  sat = Math.max(0, Math.min(255, sat + satChange));
  v = Math.max(0, Math.min(255, v + valueChange));
  return (hsv2rgb_spectrum(h, sat, v) | (W(c) << 24)) >>> 0;
}

function blink(s: Segment, color1: number, color2: number, strobe: boolean, doPalette: boolean) {
  let cycleTime = (255 - s.speed) * 20;
  let onTime = s.frametime;
  if (!strobe) onTime += (cycleTime * s.intensity) >> 8;
  cycleTime += s.frametime * 2;
  const it = Math.floor(s.now / cycleTime);
  const rem = s.now % cycleTime;
  const on = it !== s.step || rem <= onTime;
  s.step = it;
  const color = on ? color1 : color2;
  if (color === color1 && doPalette) {
    for (let i = 0; i < s.vLength; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  } else s.fill(color);
}
export const mode_blink = (s: Segment) => blink(s, s.getCurrentColor(0), s.getCurrentColor(1), false, true);
export const mode_blink_rainbow = (s: Segment) => blink(s, s.color_wheel(s.call & 0xff), s.getCurrentColor(1), false, false);
export const mode_strobe = (s: Segment) => blink(s, s.getCurrentColor(0), s.getCurrentColor(1), true, true);
export const mode_strobe_rainbow = (s: Segment) => blink(s, s.color_wheel(s.call & 0xff), s.getCurrentColor(1), true, false);

function color_wipe(s: Segment, rev: boolean, useRandomColors: boolean) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const cycleTime = 750 + (255 - s.speed) * 150;
  const perc = s.now % cycleTime;
  let prog = Math.floor((perc * 65535) / cycleTime);
  const back = prog > 32767;
  if (back) {
    prog -= 32767;
    if (s.step === 0) s.step = 1;
  } else if (s.step === 2) s.step = 3;
  if (useRandomColors) {
    if (s.call === 0) {
      s.aux0 = hw_random8();
      s.step = 3;
    }
    if (s.step === 1) {
      s.aux1 = get_random_wheel_index(s.aux0);
      s.step = 2;
    }
    if (s.step === 3) {
      s.aux0 = get_random_wheel_index(s.aux1);
      s.step = 0;
    }
  }
  const ledIndex = (prog * SEGLEN) >>> 15;
  let rem = u16(prog * SEGLEN * 2);
  rem = Math.floor(rem / (s.intensity + 1));
  if (rem > 255) rem = 255;
  const col1 = useRandomColors ? s.color_wheel(s.aux1) : s.getCurrentColor(1);
  for (let i = 0; i < SEGLEN; i++) {
    const index = rev && back ? SEGLEN - 1 - i : i;
    const col0 = useRandomColors ? s.color_wheel(s.aux0) : s.color_from_palette(index, true, SOLID_WRAP(s), 0);
    if (i < ledIndex) s.setPixelColor(index, back ? col1 : col0);
    else {
      s.setPixelColor(index, back ? col0 : col1);
      if (i === ledIndex) s.setPixelColor(index, color_blend(back ? col0 : col1, back ? col1 : col0, rem));
    }
  }
}
export const mode_color_wipe = (s: Segment) => color_wipe(s, false, false);
export const mode_color_sweep = (s: Segment) => color_wipe(s, true, false);
export const mode_color_wipe_random = (s: Segment) => color_wipe(s, false, true);
export const mode_color_sweep_random = (s: Segment) => color_wipe(s, true, true);

export function mode_random_color(s: Segment) {
  const cycleTime = 200 + (255 - s.speed) * 50;
  const it = Math.floor(s.now / cycleTime);
  const rem = s.now % cycleTime;
  const fadedur = (cycleTime * s.intensity) >> 8;
  let fade = 255;
  if (fadedur) fade = Math.min(255, Math.floor((rem * 255) / fadedur));
  if (s.call === 0) {
    s.aux0 = hw_random8();
    s.step = 2;
  }
  if (it !== s.step) {
    s.aux1 = s.aux0;
    s.aux0 = get_random_wheel_index(s.aux0);
    s.step = it;
  }
  s.fill(color_blend(s.color_wheel(s.aux1), s.color_wheel(s.aux0), fade));
}

export function mode_dynamic(s: Segment) {
  const SEGLEN = s.vLength;
  s.allocateData(SEGLEN);
  const d = s.data;
  if (s.call === 0) for (let i = 0; i < SEGLEN; i++) d[i] = hw_random8();
  const cycleTime = 50 + (255 - s.speed) * 15;
  const it = Math.floor(s.now / cycleTime);
  if (it !== s.step && s.speed !== 0) {
    for (let i = 0; i < SEGLEN; i++) if (hw_random8() <= s.intensity) d[i] = hw_random8();
    s.step = it;
  }
  if (s.check1) for (let i = 0; i < SEGLEN; i++) s.blendPixelColor(i, s.color_wheel(d[i]!), 16);
  else for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_wheel(d[i]!));
}
export function mode_dynamic_smooth(s: Segment) {
  const old = s.check1;
  s.check1 = true;
  mode_dynamic(s);
  s.check1 = old;
}

export function mode_breath(s: Segment) {
  let v = 0;
  let counter = mul32(s.now, (s.speed >> 3) + 10) & 0xffff;
  counter = (counter >> 2) + (counter >> 4);
  if (counter < 16384) {
    if (counter > 8192) counter = 8192 - (counter - 8192);
    v = Math.trunc(sin16_t(counter) / 103);
  }
  const lum = u8(30 + v);
  for (let i = 0; i < s.vLength; i++)
    s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(i, true, SOLID_WRAP(s), 0), lum));
}

export function mode_fade(s: Segment) {
  const counter = mul32(s.now, (s.speed >> 3) + 10);
  const lum = triwave16(counter) >> 8;
  for (let i = 0; i < s.vLength; i++)
    s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(i, true, SOLID_WRAP(s), 0), lum));
}

function scan(s: Segment, dual: boolean) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const cycleTime = 750 + (255 - s.speed) * 150;
  const perc = s.now % cycleTime;
  const prog = Math.floor((perc * 65535) / cycleTime);
  const size = 1 + ((s.intensity * SEGLEN) >> 9);
  const ledIndex = Math.floor((prog * (SEGLEN * 2 - size * 2)) / 65536);
  if (!s.check2) s.fill(s.getCurrentColor(1));
  const ledOffset = Math.abs(ledIndex - (SEGLEN - size));
  if (dual) {
    for (let j = ledOffset; j < ledOffset + size; j++) {
      const i2 = SEGLEN - 1 - j;
      s.setPixelColor(i2, s.color_from_palette(i2, true, SOLID_WRAP(s), s.getCurrentColor(2) ? 2 : 0));
    }
  }
  for (let j = ledOffset; j < ledOffset + size; j++) s.setPixelColor(j, s.color_from_palette(j, true, SOLID_WRAP(s), 0));
}
export const mode_scan = (s: Segment) => scan(s, false);
export const mode_dual_scan = (s: Segment) => scan(s, true);

export function mode_rainbow(s: Segment) {
  const counter = (mul32(s.now, (s.speed >> 2) + 2) & 0xffff) >> 8;
  if (s.intensity < 128) s.fill(color_blend(s.color_wheel(counter), WHITE, 128 - s.intensity));
  else s.fill(s.color_wheel(counter));
}

export function mode_rainbow_cycle(s: Segment) {
  const SEGLEN = s.vLength;
  const counter = (mul32(s.now, (s.speed >> 2) + 2) & 0xffff) >> 8;
  for (let i = 0; i < SEGLEN; i++) {
    const index = u8(Math.floor((i * (16 << Math.floor(s.intensity / 29))) / SEGLEN) + counter);
    s.setPixelColor(i, s.color_wheel(index));
  }
}

export function running(s: Segment, color1: number, color2: number, theatre = false) {
  const width = (theatre ? 3 : 1) + (s.intensity >> 4);
  const cycleTime = 50 + (255 - s.speed);
  const it = Math.floor(s.now / cycleTime);
  const usePalette = color1 === s.getCurrentColor(0);
  for (let i = 0; i < s.vLength; i++) {
    let col = color2;
    if (usePalette) color1 = s.color_from_palette(i, true, SOLID_WRAP(s), 0);
    if (theatre) {
      if (i % width === s.aux0) col = color1;
    } else {
      const pos = i % (width << 1);
      if (pos < s.aux0 - width || (pos >= s.aux0 && pos < s.aux0 + width)) col = color1;
    }
    s.setPixelColor(i, col);
  }
  if (it !== s.step) {
    s.aux0 = (s.aux0 + 1) % (theatre ? width : width << 1);
    s.step = it;
  }
}
export const mode_theater_chase = (s: Segment) => running(s, s.getCurrentColor(0), s.getCurrentColor(1), true);
export const mode_theater_chase_rainbow = (s: Segment) => running(s, s.color_wheel(s.step), s.getCurrentColor(1), true);

function running_base(s: Segment, saw: boolean, dual = false) {
  const SEGLEN = s.vLength;
  const xScale = s.intensity >> 2;
  const counter = mul32(s.now, s.speed) >>> 9;
  for (let i = 0; i < SEGLEN; i++) {
    let a = (i * xScale - counter) >>> 0;
    if (saw) {
      a &= 0xff;
      if (a < 16) a = 192 + a * 8;
      else a = map(a, 16, 255, 64, 192);
      a = 255 - a;
    }
    const sv = dual ? sin_gap(a) : sin8_t(a);
    let ca = color_blend(s.getCurrentColor(1), s.color_from_palette(i, true, SOLID_WRAP(s), 0), sv);
    if (dual) {
      const b = ((SEGLEN - 1 - i) * xScale - counter) >>> 0;
      const t = sin_gap(b);
      const cb = color_blend(s.getCurrentColor(1), s.color_from_palette(i, true, SOLID_WRAP(s), 2), t);
      ca = color_blend(ca, cb, 127);
    }
    s.setPixelColor(i, ca);
  }
}
export const mode_running_dual = (s: Segment) => running_base(s, false, true);
export const mode_running_lights = (s: Segment) => running_base(s, false);
export const mode_saw = (s: Segment) => running_base(s, true);

export function mode_twinkle(s: Segment) {
  const SEGLEN = s.vLength;
  s.fade_out(224);
  const cycleTime = 20 + (255 - s.speed) * 5;
  const it = Math.floor(s.now / cycleTime);
  if (it !== s.step) {
    const maxOn = map(s.intensity, 0, 255, 1, SEGLEN);
    if (s.aux0 >= maxOn) {
      s.aux0 = 0;
      s.aux1 = hw_random();
    }
    s.aux0++;
    s.step = it;
  }
  let prng16 = s.aux1;
  for (let i = 0; i < s.aux0; i++) {
    prng16 = u16(u16(prng16 * 2053) + 13849);
    const j = Math.floor((SEGLEN * prng16) / 65536);
    s.setPixelColor(j, s.color_from_palette(j, true, SOLID_WRAP(s), 0));
  }
}

function dissolve(s: Segment, color: number) {
  const SEGLEN = s.vLength;
  s.allocateData(4 * SEGLEN);
  const pixels = new Uint32Array(s.data.buffer, 0, SEGLEN);
  const bg = s.getCurrentColor(1);
  if (s.call === 0) {
    pixels.fill(bg);
    s.aux0 = 1;
  }
  for (let j = 0; j <= Math.floor(SEGLEN / 15); j++) {
    if (hw_random8() <= s.intensity) {
      for (let times = 0; times < 10; times++) {
        const i = hw_random16(SEGLEN);
        if (s.aux0) {
          if (pixels[i] === bg) {
            let c = color === s.getCurrentColor(0) ? s.color_from_palette(i, true, SOLID_WRAP(s), 0) : color;
            if (s.check2 && c === bg) c = (c ^ 1) >>> 0;
            pixels[i] = c;
            break;
          }
        } else if (pixels[i] !== bg) {
          pixels[i] = bg;
          break;
        }
      }
    }
  }
  let incomplete = 0;
  for (let i = 0; i < SEGLEN; i++) {
    s.setPixelColor(i, pixels[i]!);
    if (s.check2) {
      if (s.aux0 ? pixels[i] === bg : pixels[i] !== bg) incomplete++;
    }
  }
  if (s.step > 255 - s.speed + 15) {
    s.aux0 = s.aux0 ? 0 : 1;
    s.step = 0;
  } else if (s.check2) {
    if (incomplete === 0) s.step++;
  } else s.step++;
}
export const mode_dissolve = (s: Segment) => dissolve(s, s.check1 ? s.color_wheel(hw_random8()) : s.getCurrentColor(0));
export const mode_dissolve_random = (s: Segment) => dissolve(s, s.color_wheel(hw_random8()));

export function mode_sparkle(s: Segment) {
  const SEGLEN = s.vLength;
  if (!s.check2) for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 1));
  const cycleTime = 10 + (255 - s.speed) * 2;
  const it = Math.floor(s.now / cycleTime);
  if (it !== s.step) {
    s.aux0 = hw_random16(SEGLEN);
    s.step = it;
  }
  s.setPixelColor(s.aux0, s.getCurrentColor(0));
}

export function mode_flash_sparkle(s: Segment) {
  const SEGLEN = s.vLength;
  if (!s.check2) for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  if ((s.now - s.aux0) >>> 0 > s.step) {
    if (hw_random8((255 - s.intensity) >> 4) === 0) s.setPixelColor(hw_random16(SEGLEN), s.getCurrentColor(1));
    s.step = s.now;
    s.aux0 = 255 - s.speed;
  }
}

export function mode_hyper_sparkle(s: Segment) {
  const SEGLEN = s.vLength;
  if (!s.check2) for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 0));
  if ((s.now - s.aux0) >>> 0 > s.step) {
    if (hw_random8((255 - s.intensity) >> 4) === 0) {
      const len = Math.max(1, Math.trunc(SEGLEN / 3));
      for (let i = 0; i < len; i++) s.setPixelColor(hw_random16(SEGLEN), s.getCurrentColor(1));
    }
    s.step = s.now;
    s.aux0 = 255 - s.speed;
  }
}

export function mode_multi_strobe(s: Segment) {
  for (let i = 0; i < s.vLength; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 1));
  s.aux0 = 50 + 20 * (255 - s.speed);
  const count = 2 * (Math.floor(s.intensity / 10) + 1);
  if (s.aux1 < count) {
    if ((s.aux1 & 1) === 0) {
      s.fill(s.getCurrentColor(0));
      s.aux0 = 15;
    } else s.aux0 = 50;
  }
  if ((s.now - s.aux0) >>> 0 > s.step) {
    s.aux1++;
    if (s.aux1 > count) s.aux1 = 0;
    s.step = s.now;
  }
}

export function mode_android(s: Segment) {
  const SEGLEN = s.vLength;
  s.allocateData(4);
  const counter = new Uint32Array(s.data.buffer, 0, 1);
  let size = s.aux1 >> 1;
  let shrinking = s.aux1 & 1;
  if (s.now >= s.step) {
    s.step = s.now + 3 + Math.floor((8 * (255 - s.speed)) / SEGLEN);
    if (size > Math.floor((s.intensity * SEGLEN) / 255)) shrinking = 1;
    else if (size < 2) shrinking = 0;
    if (!shrinking) {
      if (counter[0]! % 3 === 1) s.aux0++;
      else size++;
    } else {
      s.aux0++;
      if (counter[0]! % 3 !== 1) size--;
    }
    s.aux1 = (size << 1) | shrinking;
    counter[0] = counter[0]! + 1;
    if (s.aux0 >= SEGLEN) s.aux0 = 0;
  }
  const start = s.aux0;
  const end = (s.aux0 + size) % SEGLEN;
  for (let i = 0; i < SEGLEN; i++) {
    if ((start < end && i >= start && i < end) || (start >= end && (i >= start || i < end))) s.setPixelColor(i, s.getCurrentColor(0));
    else s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 1));
  }
}

/** Color chase: color1 background, color2 and color3 the two moving blocks. */
export function chase(s: Segment, color1: number, color2: number, color3: number, doPalette: boolean) {
  const SEGLEN = s.vLength;
  const counter = u16(mul32(s.now, (s.speed >> 2) + 1));
  const a = u16(Math.floor((counter * SEGLEN) / 65536));
  const chaseRandom = s.mode === 29;
  if (chaseRandom) {
    if (a < s.step) {
      s.aux1 = s.aux0;
      s.aux0 = get_random_wheel_index(s.aux0);
    }
    color1 = s.color_wheel(s.aux0);
  }
  s.step = a;
  const size = 1 + ((s.intensity * SEGLEN) >> 10);
  let b = u16(a + size);
  if (b > SEGLEN) b = u16(b - SEGLEN);
  let c = u16(b + size);
  if (c > SEGLEN) c = u16(c - SEGLEN);
  if (doPalette) for (let i = 0; i < SEGLEN; i++) s.setPixelColor(i, s.color_from_palette(i, true, SOLID_WRAP(s), 1));
  else s.fill(color1);
  if (chaseRandom) {
    color1 = s.color_wheel(s.aux1);
    for (let i = a; i < SEGLEN; i++) s.setPixelColor(i, color1);
  }
  if (a < b) for (let i = a; i < b; i++) s.setPixelColor(i, color2);
  else {
    for (let i = a; i < SEGLEN; i++) s.setPixelColor(i, color2);
    for (let i = 0; i < b; i++) s.setPixelColor(i, color2);
  }
  if (b < c) for (let i = b; i < c; i++) s.setPixelColor(i, color3);
  else {
    for (let i = b; i < SEGLEN; i++) s.setPixelColor(i, color3);
    for (let i = 0; i < c; i++) s.setPixelColor(i, color3);
  }
}

export const basicEffects: Registry = {
  0: mode_static,
  1: mode_blink,
  2: mode_breath,
  3: mode_color_wipe,
  4: mode_color_wipe_random,
  5: mode_random_color,
  6: mode_color_sweep,
  7: mode_dynamic,
  8: mode_rainbow,
  9: mode_rainbow_cycle,
  10: mode_scan,
  11: mode_dual_scan,
  12: mode_fade,
  13: mode_theater_chase,
  14: mode_theater_chase_rainbow,
  15: mode_running_lights,
  16: mode_saw,
  17: mode_twinkle,
  18: mode_dissolve,
  19: mode_dissolve_random,
  20: mode_sparkle,
  21: mode_flash_sparkle,
  22: mode_hyper_sparkle,
  23: mode_strobe,
  24: mode_strobe_rainbow,
  25: mode_multi_strobe,
  26: mode_blink_rainbow,
  27: mode_android,
  36: mode_color_sweep_random,
  52: mode_running_dual,
  77: mode_copy_segment,
  117: mode_dynamic_smooth,
};
