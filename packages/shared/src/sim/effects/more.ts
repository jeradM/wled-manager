/**
 * WLED effects ported from FX.cpp (WLED main): Twinklefox through TV Simulator, plus Tetrix, Rolling Balls and PacMan.
 */
import {
  BLACK,
  BLUE,
  CHSV,
  ColorFromPalette,
  LINEARBLEND,
  NOBLEND,
  R,
  G,
  B,
  RGBW32,
  ULTRAWHITE,
  WHITE,
  color_blend,
  color_fade,
  gamma8inv,
  nblendPaletteTowardPalette,
  palette16,
  type Palette16,
} from "../color.js";
import {
  PRNG,
  beat16,
  beat8,
  beatsin16_t,
  beatsin88_t,
  beatsin8_t,
  constrain,
  cos8_t,
  cubicwave8,
  hw_random,
  hw_random16,
  hw_random8,
  map,
  mul32,
  perlin8,
  qadd8,
  qsub8,
  quadwave8,
  scale16,
  scale8,
  sin16_t,
  sin8_t,
  triwave16,
  u16,
  u8,
} from "../math.js";
import type { Segment } from "../segment.js";
import { mode_static } from "./basic.js";
import { ripple_base } from "./classic.js";
import { SOLID_WRAP, tristate_square8, type Registry } from "./common.js";

const CYAN = 0x00ffff;
const YELLOW = 0xffff00;
const rgbAverage = (c: number) => ((R(c) + G(c) + B(c)) * 21846) >>> 16;
const prng = new PRNG(hw_random() & 0xffff);
/** FAIR_DATA_PER_SEG on ESP32: 64 kB shared by 32 segments. */
const FAIR_DATA_PER_SEG = 2048;
const MAX_SEGMENTS = 32;
const activeSegments = (s: Segment) => s.strip.segments.filter((x) => x.isActive).length;

export function mode_ripple_rainbow(s: Segment) {
  if (s.vLength <= 1) return mode_static(s);
  if (s.call === 0) {
    s.aux0 = hw_random8();
    s.aux1 = hw_random8();
  }
  if (s.aux0 === s.aux1) s.aux1 = hw_random8();
  else if (s.aux1 > s.aux0) s.aux0++;
  else s.aux0--;
  s.fill(color_blend(s.color_wheel(s.aux0), BLACK, 235));
  ripple_base(s);
}

function twinklefox_one_twinkle(s: Segment, ms: number, salt: number, cat: boolean): number {
  const ticks = Math.floor(ms / s.aux0);
  const fastcycle8 = ticks & 0xff;
  let slowcycle16 = u16((ticks >>> 8) + salt);
  slowcycle16 = u16(slowcycle16 + sin8_t(slowcycle16));
  slowcycle16 = u16(slowcycle16 * 2053 + 1384);
  const slowcycle8 = u8((slowcycle16 & 0xff) + (slowcycle16 >> 8));
  const twinkleDensity = (s.intensity >> 5) + 1;
  let bright = 0;
  if ((slowcycle8 & 0x0e) / 2 < twinkleDensity) {
    let ph = fastcycle8;
    if (cat) {
      bright = 255 - ph;
      if (s.check2) bright = ph;
    } else if (ph < 86) bright = ph * 3;
    else {
      ph -= 86;
      bright = 255 - (ph + (ph >> 1));
    }
  }
  const hue = (slowcycle8 - salt) & 0xff;
  if (bright <= 0) return 0;
  let c = ColorFromPalette(s.currentPalette, hue, gamma8inv(bright), NOBLEND);
  if (!s.check1 && fastcycle8 >= 128) {
    const cooling = (fastcycle8 - 128) >> 4;
    c = RGBW32(R(c), qsub8(G(c), cooling), qsub8(B(c), cooling * 2));
  }
  return c;
}

function twinklefox_base(s: Segment, cat: boolean) {
  let prng16 = 11337;
  if (s.speed > 100) s.aux0 = 3 + ((255 - s.speed) >> 3);
  else s.aux0 = 22 + ((100 - s.speed) >> 1);
  let bg = s.getCurrentColor(1);
  let bglight = rgbAverage(bg);
  if (bglight > 64) bg = color_fade(bg, gamma8inv(16), true);
  else if (bglight > 16) bg = color_fade(bg, gamma8inv(64), true);
  else bg = color_fade(bg, gamma8inv(86), true);
  bglight = rgbAverage(bg);
  for (let i = 0; i < s.vLength; i++) {
    prng16 = u16(u16(prng16 * 2053) + 1384);
    const myclockoffset16 = prng16;
    prng16 = u16(u16(prng16 * 2053) + 1384);
    const mult = ((((prng16 & 0xff) >> 4) + (prng16 & 0x0f)) & 0x0f) + 0x08;
    const myclock30 = ((mul32(s.now, mult) >>> 3) + myclockoffset16) >>> 0;
    const myunique8 = prng16 >> 8;
    const c = twinklefox_one_twinkle(s, myclock30, myunique8, cat);
    const deltabright = rgbAverage(c) - bglight;
    if (deltabright >= 32 || bg === 0) s.setPixelColor(i, c);
    else if (deltabright > 0) s.setPixelColor(i, color_blend(bg, c, u8(deltabright * 8)));
    else s.setPixelColor(i, bg);
  }
}
export const mode_twinklefox = (s: Segment) => twinklefox_base(s, false);
export const mode_twinklecat = (s: Segment) => twinklefox_base(s, true);

export function mode_halloween_eyes(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const maxWidth = SEGLEN;
  const SPACE = Math.max(2, SEGLEN >> 5);
  const WIDTH = SPACE >> 1;
  const eyeLength = 2 * WIDTH + SPACE;
  if (eyeLength >= maxWidth) return mode_static(s);
  type Eye = { state: number; color: number; startPos: number; duration: number; startTime: number; blinkEndTime: number };
  if (!s.state) s.state = { state: 0, color: 0, startPos: 0, duration: 0, startTime: 0, blinkEndTime: 0 } satisfies Eye;
  const data = s.state as Eye;
  if (!s.check2) s.fill(s.getCurrentColor(1));
  data.state %= 5;
  let duration = Math.max(1, data.duration);
  const elapsed = (s.now - data.startTime) >>> 0;
  switch (data.state) {
    case 0:
      data.startPos = hw_random16(0, maxWidth - eyeLength - 1);
      data.color = hw_random8();
      duration = 128 + hw_random16(s.intensity * 64);
      data.duration = duration & 0xffff;
      data.state = 1;
    // falls through
    case 1: {
      const start2nd = data.startPos + WIDTH + SPACE;
      duration = Math.min(duration, 128 + s.intensity * 64);
      const fadeIn = Math.floor((elapsed * 256 * 8) / duration);
      const bgc = s.getCurrentColor(1);
      const eyeColor = s.color_from_palette(data.color, false, false, 0);
      let c = eyeColor;
      if (fadeIn < 256) c = color_blend(bgc, eyeColor, fadeIn);
      else if (elapsed > 1024) {
        const remaining = elapsed >= duration ? 0 : duration - elapsed;
        if (remaining > 1024 && hw_random8() < 4) {
          c = bgc;
          data.state = 2;
          data.blinkEndTime = s.now + hw_random8(8, 128);
        }
      }
      if (c !== bgc) {
        for (let i = 0; i < WIDTH; i++) {
          s.setPixelColor(data.startPos + i, c);
          s.setPixelColor(start2nd + i, c);
        }
      }
      break;
    }
    case 2:
      if (s.now >= data.blinkEndTime) data.state = 1;
      break;
    case 3: {
      const base = s.speed * 128;
      duration = base + hw_random16(base);
      data.duration = duration & 0xffff;
      data.state = 4;
    }
    // falls through
    case 4:
      duration = Math.min(duration, 2 * s.speed * 128);
      break;
  }
  if (elapsed > duration) {
    data.state = data.state <= 2 ? 3 : 0;
    data.startTime = s.now;
  }
}

export function mode_static_pattern(s: Segment) {
  const lit = 1 + s.speed;
  const unlit = 1 + s.intensity;
  let drawingLit = true;
  let cnt = 0;
  for (let i = 0; i < s.vLength; i++) {
    s.setPixelColor(i, drawingLit ? s.color_from_palette(i, true, SOLID_WRAP(s), 0) : s.getCurrentColor(1));
    cnt++;
    if (cnt >= (drawingLit ? lit : unlit)) {
      cnt = 0;
      drawingLit = !drawingLit;
    }
  }
}

export function mode_tri_static_pattern(s: Segment) {
  const segSize = (s.intensity >> 5) + 1;
  let currSeg = 0;
  let count = 0;
  for (let i = 0; i < s.vLength; i++) {
    s.setPixelColor(i, s.getCurrentColor(currSeg % 3));
    count++;
    if (count >= segSize) {
      currSeg++;
      count = 0;
    }
  }
}

function spots_base(s: Segment, threshold: number) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  if (!s.check2) s.fill(s.getCurrentColor(1));
  const maxZones = SEGLEN >> 2;
  const zones = 1 + ((s.intensity * maxZones) >> 8);
  const zoneLen = Math.floor(SEGLEN / zones);
  const offset = (SEGLEN - zones * zoneLen) >> 1;
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen;
    for (let i = 0; i < zoneLen; i++) {
      const wave = triwave16(Math.floor((i * 0xffff) / zoneLen));
      if (wave > threshold) {
        const index = pos + i;
        const sv = Math.floor(((wave - threshold) * 255) / (0xffff - threshold));
        s.setPixelColor(index, color_blend(s.color_from_palette(index, true, SOLID_WRAP(s), 0), s.getCurrentColor(1), u8(255 - sv)));
      }
    }
  }
}
export const mode_spots = (s: Segment) => spots_base(s, (255 - s.speed) << 8);
export function mode_spots_fade(s: Segment) {
  const counter = mul32(s.now, (s.speed >> 2) + 8);
  const t = triwave16(counter);
  spots_base(s, (t >> 1) + (t >> 2));
}

export function mode_bouncing_balls(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const maxNumBalls = 16;
  type Ball = { lastBounceTime: number; impactVelocity: number; height: number };
  if (!s.state) s.state = Array.from({ length: maxNumBalls }, (): Ball => ({ lastBounceTime: 0, impactVelocity: 0, height: 0 }));
  const balls = s.state as Ball[];
  if (!s.check2) s.fill(s.getCurrentColor(2) ? BLACK : s.getCurrentColor(1));
  const numBalls = Math.floor((s.intensity * (maxNumBalls - 1)) / 255) + 1;
  const gravity = -9.81;
  const hasCol2 = !!s.getCurrentColor(2);
  const time = s.now;
  if (s.call === 0) for (const b of balls) b.lastBounceTime = time;
  for (let i = 0; i < numBalls; i++) {
    const b = balls[i]!;
    const timeSinceLastBounce = Math.floor((time - b.lastBounceTime) / (Math.floor((255 - s.speed) / 64) + 1));
    const timeSec = timeSinceLastBounce / 1000;
    b.height = (0.5 * gravity * timeSec + b.impactVelocity) * timeSec;
    if (b.height <= 0) {
      b.height = 0;
      const dampening = 0.9 - i / (numBalls * numBalls);
      b.impactVelocity = dampening * b.impactVelocity;
      b.lastBounceTime = time;
      if (b.impactVelocity < 0.015) b.impactVelocity = (Math.sqrt(-2 * gravity) * hw_random8(5, 11)) / 10;
    } else if (b.height > 1) continue;
    let color = s.getCurrentColor(0);
    if (s.paletteId) color = s.color_wheel(i * Math.floor(256 / Math.max(numBalls, 8)));
    else if (hasCol2) color = s.getCurrentColor(i % 3);
    s.setPixelColor(Math.round(b.height * (SEGLEN - 1)), color);
  }
}

export function mode_rolling_balls(s: Segment) {
  const SEGLEN = s.vLength;
  const maxNumBalls = 16;
  type RBall = { lastBounceUpdate: number; mass: number; velocity: number; height: number };
  const numBalls = Math.floor(s.intensity / 16) + 1;
  const hasCol2 = !!s.getCurrentColor(2);
  if (s.call === 0 || !s.state) {
    s.fill(hasCol2 ? BLACK : s.getCurrentColor(1));
    s.state = Array.from({ length: maxNumBalls }, (): RBall => {
      let velocity = (20 * hw_random16(1000, 10000)) / 10000;
      if (hw_random8() < 128) velocity = -velocity;
      return { lastBounceUpdate: s.now, velocity, height: hw_random16(0, 10000) / 10000, mass: hw_random16(1000, 10000) / 10000 };
    });
  }
  const balls = s.state as RBall[];
  const cfac = (scale8(8, 255 - s.speed) + 1) * 20000;
  if (s.check3) s.fade_out(250);
  else if (!s.check2) s.fill(hasCol2 ? BLACK : s.getCurrentColor(1));
  for (let i = 0; i < numBalls; i++) {
    const bi = balls[i]!;
    const dt = (s.now - bi.lastBounceUpdate) / cfac;
    let thisHeight = bi.height + bi.velocity * dt;
    if (thisHeight < -0.5 || thisHeight > 1.5) {
      thisHeight = bi.height = hw_random16(0, 10000) / 10000;
      bi.lastBounceUpdate = s.now;
    }
    if ((thisHeight <= 0 && bi.velocity < 0) || (thisHeight >= 1 && bi.velocity > 0)) {
      bi.velocity = -bi.velocity;
      bi.lastBounceUpdate = s.now;
      bi.height = thisHeight;
    }
    if (s.check1) {
      for (let j = i + 1; j < numBalls; j++) {
        const bj = balls[j]!;
        if (bj.velocity !== bi.velocity) {
          const tcollided = (cfac * (bi.height - bj.height) + bi.velocity * (bj.lastBounceUpdate - bi.lastBounceUpdate)) / (bj.velocity - bi.velocity);
          if (tcollided > 2 && tcollided < s.now - bj.lastBounceUpdate) {
            bi.height = bi.height + (bi.velocity * (tcollided + (bj.lastBounceUpdate - bi.lastBounceUpdate))) / cfac;
            bj.height = bi.height;
            bi.lastBounceUpdate = Math.trunc(tcollided + 0.5) + bj.lastBounceUpdate;
            bj.lastBounceUpdate = bi.lastBounceUpdate;
            const vtmp = bi.velocity;
            bi.velocity = ((bi.mass - bj.mass) * vtmp + 2 * bj.mass * bj.velocity) / (bi.mass + bj.mass);
            bj.velocity = ((bj.mass - bi.mass) * bj.velocity + 2 * bi.mass * vtmp) / (bi.mass + bj.mass);
            thisHeight = bi.height + (bi.velocity * (s.now - bi.lastBounceUpdate)) / cfac;
          }
        }
      }
    }
    let color = s.getCurrentColor(0);
    if (s.paletteId) color = s.color_from_palette(Math.floor((i * 255) / numBalls), false, SOLID_WRAP(s), 0);
    else if (hasCol2) color = s.getCurrentColor(i % 3);
    thisHeight = Math.min(1, Math.max(0, thisHeight));
    s.setPixelColor(Math.round(thisHeight * (SEGLEN - 1)), color);
    bi.lastBounceUpdate = s.now;
    bi.height = thisHeight;
  }
}

export function mode_pacman(s: Segment) {
  const SEGLEN = s.vLength;
  const ORANGEYELLOW = 0xffcc00;
  const PURPLEISH = 0xb000b0;
  const ORANGEISH = 0xff8800;
  const WHITEISH = 0x999999;
  const ghostColors = [0xff0000, PURPLEISH, CYAN, ORANGEISH];
  const maxPowerDots = Math.min(Math.floor(SEGLEN / 10), 255);
  const numPowerDots = map(s.intensity, 0, 255, 1, maxPowerDots);
  const numGhosts = map(s.custom3, 0, 31, 2, 8);
  const smear = s.check2;
  const combined = u16(((numPowerDots & 0xff) << 8) | (numGhosts & 0xff));
  if (combined !== s.aux0) s.call = 0;
  s.aux0 = combined;
  if (SEGLEN <= 16 + 2 * numGhosts) return mode_static(s);
  type Ch = { pos: number; topPos: number; color: number; direction: boolean; blue: boolean; eaten: boolean };
  if (s.call === 0 || !s.state || s.state.length !== numGhosts + maxPowerDots + 1)
    s.state = Array.from({ length: numGhosts + maxPowerDots + 1 }, (): Ch => ({ pos: 0, topPos: 0, color: 0, direction: false, blue: false, eaten: false }));
  const ch = s.state as Ch[];
  const P = ch[0]!;
  let maxBlinkPos = s.call === 0 ? SEGLEN - 1 : P.topPos;
  if (maxBlinkPos < 20) maxBlinkPos = 20;
  const startBlinking = SEGLEN < 64 ? Math.floor(SEGLEN / 3) : map(s.custom1, 0, 255, 20, maxBlinkPos);
  if (s.call === 0) {
    Object.assign(P, { color: YELLOW, pos: 0, topPos: 0, direction: true, blue: false });
    for (let i = 1; i <= numGhosts; i++) Object.assign(ch[i]!, { color: ghostColors[(i - 1) % 4], pos: -2 * (i + 1), direction: true, blue: false });
    for (let i = 0; i < numPowerDots; i++) Object.assign(ch[i + numGhosts + 1]!, { color: ORANGEYELLOW, eaten: false });
    ch[numGhosts + 1]!.pos = SEGLEN - 1;
  }
  if (s.now > s.step) {
    s.step = s.now;
    s.aux1++;
  }
  if (!smear) s.fill(BLACK);
  if (s.check1) {
    const step = s.check3 ? 1 : 2;
    for (let i = SEGLEN - 1; i > P.topPos; i -= step) s.setPixelColor(i, WHITEISH);
  }
  const everyXLeds = Math.floor(((SEGLEN - 10) << 8) / numPowerDots);
  for (let i = 1; i < numPowerDots; i++) ch[i + numGhosts + 1]!.pos = 10 + ((i * everyXLeds) >> 8);
  if (s.aux1 % 10 === 0) {
    const dotColor = ch[numGhosts + 1]!.color === ORANGEYELLOW ? BLACK : ORANGEYELLOW;
    for (let i = 0; i < numPowerDots; i++) ch[i + numGhosts + 1]!.color = dotColor;
  }
  if (s.aux1 % 15 === 0 && ch[1]!.blue && P.pos <= startBlinking) {
    const ghostColor = ch[1]!.color === BLUE ? WHITEISH : BLUE;
    for (let i = 1; i <= numGhosts; i++) ch[i]!.color = ghostColor;
  }
  for (let i = 0; i < numPowerDots; i++) {
    const d = ch[i + numGhosts + 1]!;
    if (!d.eaten && d.pos >= 0 && d.pos < SEGLEN) s.setPixelColor(d.pos, d.color);
  }
  for (let j = 0; j < numPowerDots; j++) {
    const dot = ch[j + numGhosts + 1]!;
    if (P.pos === dot.pos && !dot.eaten) {
      for (let i = 0; i <= numGhosts; i++) ch[i]!.direction = false;
      for (let i = 1; i <= numGhosts; i++) {
        ch[i]!.color = BLUE;
        ch[i]!.blue = true;
      }
      dot.eaten = true;
      break;
    }
  }
  if (ch[1]!.blue && P.pos <= 0) {
    for (let i = 0; i <= numGhosts; i++) ch[i]!.direction = true;
    for (let i = 1; i <= numGhosts; i++) {
      ch[i]!.color = ghostColors[(i - 1) % 4]!;
      ch[i]!.blue = false;
    }
    if (ch[numGhosts + 1]!.eaten) {
      for (let i = 0; i < numPowerDots; i++) ch[i + numGhosts + 1]!.eaten = false;
      P.topPos = 0;
    }
  }
  if (s.aux1 % map(s.speed, 0, 255, 15, 1) === 0) {
    P.pos += P.direction ? 1 : -1;
    for (let i = 1; i <= numGhosts; i++) ch[i]!.pos += ch[i]!.direction ? 1 : -1;
  }
  if (P.pos >= 0 && P.pos < SEGLEN) s.setPixelColor(P.pos, P.color);
  for (let i = 1; i <= numGhosts; i++) if (ch[i]!.pos >= 0 && ch[i]!.pos < SEGLEN) s.setPixelColor(ch[i]!.pos, ch[i]!.color);
  if (P.topPos < P.pos) P.topPos = P.pos;
  s.blur(s.custom2 >> 1);
}

function sinelon_base(s: Segment, dual: boolean, rainbow = false) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.fade_out(s.intensity);
  const pos = beatsin16_t(Math.floor(s.speed / 10), 0, SEGLEN - 1);
  if (s.call === 0) s.aux0 = pos;
  let color1 = s.color_from_palette(pos, true, false, 0);
  let color2 = s.getCurrentColor(2);
  if (rainbow) color1 = s.color_wheel((pos & 0x07) * 32);
  s.setPixelColor(pos, color1);
  if (dual) {
    if (!color2) color2 = s.color_from_palette(pos, true, false, 0);
    if (rainbow) color2 = color1;
    s.setPixelColor(SEGLEN - 1 - pos, color2);
  }
  if (s.aux0 !== pos) {
    if (s.aux0 < pos) {
      for (let i = s.aux0; i < pos; i++) {
        s.setPixelColor(i, color1);
        if (dual) s.setPixelColor(SEGLEN - 1 - i, color2);
      }
    } else {
      for (let i = s.aux0; i > pos; i--) {
        s.setPixelColor(i, color1);
        if (dual) s.setPixelColor(SEGLEN - 1 - i, color2);
      }
    }
    s.aux0 = pos;
  }
}
export const mode_sinelon = (s: Segment) => sinelon_base(s, false);
export const mode_sinelon_dual = (s: Segment) => sinelon_base(s, true);
export const mode_sinelon_rainbow = (s: Segment) => sinelon_base(s, false, true);

function glitter_base(s: Segment, intensity: number, col = ULTRAWHITE) {
  if (intensity > hw_random8()) s.setPixelColor(hw_random16(s.vLength), col);
}
export function mode_glitter(s: Segment) {
  const SEGLEN = s.vLength;
  if (!s.check2) {
    let counter = 0;
    if (s.speed !== 0) counter = (mul32(s.now, (s.speed >> 3) + 1) & 0xffff) >> 8;
    const noWrap = s.strip.paletteBlend === 2 || (s.strip.paletteBlend === 0 && s.speed === 0);
    for (let i = 0; i < SEGLEN; i++) {
      let colorIndex = (Math.floor((i * 255) / SEGLEN) - counter) >>> 0;
      if (noWrap) colorIndex = map(colorIndex, 0, 255, 0, 240);
      s.setPixelColor(i, s.color_from_palette(colorIndex, false, true, 255));
    }
  }
  glitter_base(s, s.intensity, s.getCurrentColor(2) ? s.getCurrentColor(2) : ULTRAWHITE);
}
export function mode_solid_glitter(s: Segment) {
  s.fill(s.getCurrentColor(0));
  glitter_base(s, s.intensity, s.getCurrentColor(2) ? s.getCurrentColor(2) : ULTRAWHITE);
}

type Spark = { pos: number; posX: number; vel: number; velX: number; col: number; colIndex: number };
const newSparks = (n: number) => Array.from({ length: n }, (): Spark => ({ pos: 0, posX: 0, vel: 0, velX: 0, col: 0, colIndex: 0 }));

export function mode_popcorn(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const usable = 21;
  if (!s.state) s.state = newSparks(usable);
  const popcorn = s.state as Spark[];
  const hasCol2 = !!s.getCurrentColor(2);
  if (!s.check2) s.fill(hasCol2 ? BLACK : s.getCurrentColor(1));
  const gravity = (-0.0001 - s.speed / 200000) * SEGLEN;
  let numPopcorn = Math.floor((s.intensity * usable) / 255);
  if (numPopcorn === 0) numPopcorn = 1;
  for (let i = 0; i < numPopcorn; i++) {
    const p = popcorn[i]!;
    if (p.pos >= 0) {
      p.pos += p.vel;
      p.vel += gravity;
    } else if (hw_random8() < 2) {
      p.pos = 0.01;
      let peak = 128 + hw_random8(128);
      peak = (peak * (SEGLEN - 1)) >> 8;
      p.vel = Math.sqrt(-2 * gravity * peak);
      if (s.paletteId) p.colIndex = hw_random8();
      else {
        let col = hw_random8(0, 3);
        if (!s.getCurrentColor(2) || !s.getCurrentColor(col)) col = 0;
        p.colIndex = col;
      }
    }
    if (p.pos >= 0) {
      let col = s.color_wheel(p.colIndex);
      if (!s.paletteId && p.colIndex < 3) col = s.getCurrentColor(p.colIndex);
      const ledIndex = Math.trunc(p.pos);
      if (ledIndex < SEGLEN) s.setPixelColor(ledIndex, col);
    }
  }
}

function candle(s: Segment, multi: boolean) {
  const SEGLEN = s.vLength;
  if (multi && SEGLEN > 1) s.allocateData(4 + Math.max(1, SEGLEN - 1) * 3);
  else s.allocateData(4);
  const lastcall = new Uint32Array(s.data.buffer, 0, 1);
  const candleData = new Uint8Array(s.data.buffer, 4);
  if ((s.now - lastcall[0]!) >>> 0 < 23) return;
  lastcall[0] = s.now;
  const valrange = s.intensity;
  const rndval = valrange >> 1;
  let speedFactor = 4;
  if (s.speed > 252) speedFactor = 1;
  else if (s.speed > 99) speedFactor = 2;
  else if (s.speed > 49) speedFactor = 3;
  const numCandles = multi ? SEGLEN : 1;
  for (let i = 0; i < numCandles; i++) {
    let d = 0;
    let sv = s.aux0;
    let target = s.aux1;
    let fadeStep = s.step;
    if (i > 0) {
      d = (i - 1) * 3;
      sv = candleData[d]!;
      target = candleData[d + 1]!;
      fadeStep = candleData[d + 2]!;
    }
    if (fadeStep === 0) {
      sv = 128;
      target = 130 + hw_random8(4);
      fadeStep = 1;
    }
    let newTarget = false;
    if (target > sv) {
      sv = qadd8(sv, fadeStep);
      if (sv >= target) newTarget = true;
    } else {
      sv = qsub8(sv, fadeStep);
      if (sv <= target) newTarget = true;
    }
    if (newTarget) {
      target = hw_random8(rndval) + hw_random8(rndval);
      if (target < rndval >> 1) target = (rndval >> 1) + hw_random8(rndval);
      target += 255 - valrange;
      const dif = target > sv ? target - sv : sv - target;
      fadeStep = dif >> speedFactor;
      if (fadeStep === 0) fadeStep = 1;
    }
    if (i > 0) {
      s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(i, true, SOLID_WRAP(s), 0), u8(sv)));
      candleData[d] = sv;
      candleData[d + 1] = target;
      candleData[d + 2] = fadeStep;
    } else {
      for (let j = 0; j < SEGLEN; j++)
        s.setPixelColor(j, color_blend(s.getCurrentColor(1), s.color_from_palette(j, true, SOLID_WRAP(s), 0), u8(sv)));
      s.aux0 = sv;
      s.aux1 = target;
      s.step = fadeStep;
    }
  }
}
export const mode_candle = (s: Segment) => candle(s, false);
export const mode_candle_multi = (s: Segment) => candle(s, true);

const STARBURST_MAX_FRAG = 10;
export function mode_starburst(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  let maxData = FAIR_DATA_PER_SEG;
  const segs = activeSegments(s);
  if (segs <= MAX_SEGMENTS / 2) maxData *= 2;
  if (segs <= MAX_SEGMENTS / 4) maxData *= 2;
  const maxStars = Math.floor(maxData / 60);
  const numStars = Math.min(1 + (SEGLEN >> 3), maxStars);
  type Star = { color: number; birth: number; last: number; vel: number; pos: number; fragment: number[] };
  if (!s.state || s.state.length !== numStars)
    s.state = Array.from({ length: numStars }, (): Star => ({ color: 0, birth: 0, last: 0, vel: 0, pos: 0xffff, fragment: new Array(STARBURST_MAX_FRAG).fill(0) }));
  const stars = s.state as Star[];
  const it = s.now;
  const maxSpeed = 375;
  const particleIgnition = 250;
  const particleFadeTime = 1500;
  for (const st of stars) {
    if (hw_random8(144 - (s.speed >> 1)) === 0 && st.birth === 0) {
      const startPos = hw_random16(SEGLEN - 1);
      const multiplier = hw_random8() / 255;
      st.color = s.color_wheel(hw_random8()) & 0xffffff;
      st.pos = startPos;
      st.vel = ((maxSpeed * hw_random8()) / 255) * multiplier;
      st.birth = it;
      st.last = it;
      const num = hw_random8(3, 6 + (s.intensity >> 5));
      for (let i = 0; i < STARBURST_MAX_FRAG; i++) st.fragment[i] = i < num ? startPos : -1;
    }
  }
  if (!s.check2) s.fill(s.getCurrentColor(1));
  for (const st of stars) {
    if (st.birth !== 0) {
      const dt = (it - st.last) / 1000;
      for (let i = 0; i < STARBURST_MAX_FRAG; i++) {
        const v = i >> 1;
        if (st.fragment[i]! > 0) st.fragment[i] = st.fragment[i]! + (st.vel * dt * v) / 3;
      }
      st.last = it;
      st.vel -= 3 * st.vel * dt;
    }
    let c = st.color;
    let fade = 0;
    let age = it - st.birth;
    if (age < particleIgnition) c = color_blend(WHITE, c, Math.trunc(254.5 * (age / particleIgnition)) & 0xff) & 0xffffff;
    else if (age > particleIgnition + particleFadeTime) {
      fade = 1;
      st.birth = 0;
      c = s.getCurrentColor(1) & 0xffffff;
    } else {
      age -= particleIgnition;
      fade = age / particleFadeTime;
      c = color_blend(c, s.getCurrentColor(1), Math.trunc(254.5 * fade) & 0xff) & 0xffffff;
    }
    const particleSize = (1 - fade) * 2;
    for (let index = 0; index < STARBURST_MAX_FRAG * 2; index++) {
      const mirrored = index & 1;
      const i = index >> 1;
      if (st.fragment[i]! > 0) {
        let loc = st.fragment[i]!;
        if (mirrored) loc -= (loc - st.pos) * 2;
        let start = Math.trunc(loc - particleSize) >>> 0;
        let end = Math.trunc(loc + particleSize) >>> 0;
        if (start === end) end++;
        if (end > SEGLEN) end = SEGLEN;
        for (let p = start; p < end; p++) s.setPixelColor(p, c);
        void start;
      }
    }
  }
}

export function mode_exploding_fireworks(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const rows = SEGLEN;
  let maxData = FAIR_DATA_PER_SEG;
  const segs = activeSegments(s);
  if (segs <= MAX_SEGMENTS / 2) maxData *= 2;
  if (segs <= MAX_SEGMENTS / 4) maxData *= 2;
  const maxSparks = Math.floor(maxData / 20);
  const numSparks = Math.min(5 + (rows >> 1), maxSparks);
  type St = { sparks: Spark[]; dying: number };
  const dataSize = 20 * numSparks;
  if (!s.state || s.aux1 !== (dataSize & 0xffff)) {
    s.state = { sparks: newSparks(numSparks), dying: 0 } satisfies St;
    s.aux0 = 0;
    s.aux1 = dataSize;
  }
  const st = s.state as St;
  const sparks = st.sparks;
  const flare = sparks[0]!;
  s.fade_out(252);
  const gravity = (-0.0004 - s.speed / 800000) * rows;
  if (s.aux0 < 2) {
    if (s.aux0 === 0) {
      flare.pos = 0;
      flare.posX = s.intensity > hw_random8() ? 1 : 0;
      let peak = 75 + hw_random8(180);
      peak = (peak * (rows - 1)) >> 8;
      flare.vel = Math.sqrt(-2 * gravity * peak);
      flare.velX = 0;
      flare.col = 255;
      s.aux0 = 1;
    }
    if (flare.vel > 12 * gravity) {
      const c = flare.col & 0xff;
      s.setPixelColor(flare.posX > 0 ? rows - Math.trunc(flare.pos) - 1 : Math.trunc(flare.pos), RGBW32(c, c, c));
      flare.pos = constrain(flare.pos + flare.vel, 0, rows - 1);
      flare.vel += gravity;
      flare.col = (flare.col - 2) & 0xffff;
    } else s.aux0 = 2;
  } else if (s.aux0 < 4) {
    let nSparks = Math.trunc(flare.pos + hw_random8(4));
    nSparks = Math.min(Math.max(nSparks, 4), numSparks);
    if (s.aux0 === 2) {
      for (let i = 1; i < nSparks; i++) {
        const sp = sparks[i]!;
        sp.pos = flare.pos;
        sp.posX = flare.posX;
        sp.vel = hw_random16(20001) / 10000 - 0.9;
        sp.vel *= rows < 32 ? 0.5 : 1;
        sp.velX = 0;
        sp.col = 345;
        sp.colIndex = hw_random8();
        sp.vel *= flare.pos / rows;
        sp.vel *= -gravity * 50;
      }
      st.dying = gravity / 2;
      s.aux0 = 3;
    }
    if (sparks[1]!.col > 4) {
      for (let i = 1; i < nSparks; i++) {
        const sp = sparks[i]!;
        sp.pos += sp.vel;
        sp.posX += sp.velX;
        sp.vel += st.dying;
        if (sp.col > 3) sp.col -= 4;
        if (sp.pos > 0 && sp.pos < rows) {
          const prog = sp.col;
          const spColor = s.paletteId ? s.color_wheel(sp.colIndex) : s.getCurrentColor(0);
          let c = 0;
          if (prog > 300) c = color_blend(spColor, WHITE, ((prog - 300) * 5) & 0xff);
          else if (prog > 45) {
            c = color_blend(BLACK, spColor, (prog - 45) & 0xff);
            const cooling = (300 - prog) >> 5;
            c = (RGBW32(R(c), qsub8(G(c), cooling), qsub8(B(c), cooling * 2)) | (c & 0xff000000)) >>> 0;
          }
          s.setPixelColor(Math.trunc(sp.posX) ? rows - Math.trunc(sp.pos) - 1 : Math.trunc(sp.pos), c);
        }
      }
      if (s.check3) s.blur(16);
      st.dying *= 0.8;
    } else s.aux0 = 6 + hw_random8(10);
  } else {
    s.aux0--;
    if (s.aux0 < 4) s.aux0 = 0;
  }
}

export function mode_drip(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  if (!s.state) s.state = newSparks(4);
  const drops = s.state as Spark[];
  if (!s.check2) s.fill(s.getCurrentColor(1));
  const numDrops = 1 + (s.intensity >> 6);
  const gravity = (-0.0005 - s.speed / 50000) * Math.max(1, SEGLEN - 1);
  const sourcedrop = 12;
  const c0 = s.getCurrentColor(0);
  for (let j = 0; j < numDrops; j++) {
    const d = drops[j]!;
    if (d.colIndex === 0) {
      d.pos = SEGLEN - 1;
      d.vel = 0;
      d.col = sourcedrop;
      d.colIndex = 1;
    }
    s.setPixelColor(SEGLEN - 1, color_blend(BLACK, c0, sourcedrop));
    if (d.colIndex === 1) {
      if (d.col > 255) d.col = 255;
      s.setPixelColor(u16(Math.trunc(d.pos)), color_blend(BLACK, c0, d.col & 0xff));
      d.col = (d.col + map(s.speed, 0, 255, 1, 6)) & 0xffff;
      if (hw_random8() < Math.floor(d.col / 10)) {
        d.colIndex = 2;
        d.col = 255;
      }
    }
    if (d.colIndex > 1) {
      if (d.pos > 0) {
        d.pos += d.vel;
        if (d.pos < 0) d.pos = 0;
        d.vel += gravity;
        for (let i = 1; i < 7 - d.colIndex; i++) {
          const pos = constrain((Math.trunc(d.pos) >>> 0) + i, 0, SEGLEN - 1);
          s.setPixelColor(pos, color_blend(BLACK, c0, Math.floor(d.col / i) & 0xff));
        }
        if (d.colIndex > 2) s.setPixelColor(0, color_blend(c0, BLACK, d.col & 0xff));
      } else if (d.colIndex > 2) {
        d.colIndex = 0;
        d.col = sourcedrop;
      } else {
        if (d.colIndex === 2) {
          d.vel = -d.vel / 4;
          d.pos += d.vel;
        }
        d.col = sourcedrop * 2;
        d.colIndex = 5;
      }
    }
  }
}

export function mode_tetrix(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  type Tetris = { pos: number; speed: number; col: number; brick: number; stack: number; step: number };
  if (!s.state) s.state = { pos: 0, speed: 0, col: 0, brick: 0, stack: 0, step: 0 } satisfies Tetris;
  const drop = s.state as Tetris;
  if (s.call === 0) {
    drop.stack = 0;
    drop.step = s.now + 2000;
    if (s.check1) drop.col = 0;
  }
  if (drop.step === 0) {
    let speed = s.speed ? s.speed : hw_random8(1, 255);
    speed = map(speed, 1, 255, 5000, 250);
    drop.speed = (SEGLEN * s.frametime) / speed;
    drop.pos = SEGLEN;
    if (!s.check1) drop.col = (hw_random8(0, 15) << 4) & 0xff;
    drop.step = 1;
    drop.brick = ((s.intensity ? (s.intensity >> 5) + 1 : hw_random8(1, 5)) * (1 + (SEGLEN >> 6))) & 0xffff;
  }
  if (drop.step === 1 && hw_random8() >> 6) drop.step = 2;
  if (drop.step === 2) {
    if (drop.pos > drop.stack) {
      drop.pos -= drop.speed;
      if (Math.trunc(drop.pos) < drop.stack) drop.pos = drop.stack;
      for (let i = Math.trunc(drop.pos); i < SEGLEN; i++) {
        const col = i < Math.trunc(drop.pos) + drop.brick ? s.color_from_palette(drop.col, false, false, 0) : s.getCurrentColor(1);
        s.setPixelColor(i, col);
      }
    } else {
      drop.step = 0;
      drop.stack = (drop.stack + drop.brick) & 0xffff;
      if (drop.stack >= SEGLEN) drop.step = s.now + 2000;
    }
  }
  if (drop.step > 2) {
    drop.brick = 0;
    if (drop.step > s.now) {
      for (let i = 0; i < SEGLEN; i++) s.blendPixelColor(i, s.getCurrentColor(1), 25);
    } else {
      drop.stack = 0;
      drop.step = 0;
      if (s.check1) drop.col = (drop.col + 8) & 0xff;
    }
  }
}

export function mode_plasma(s: Segment) {
  if (s.call === 0) s.aux0 = hw_random8(0, 2);
  const thisPhase = beatsin8_t(6 + s.aux0, -64 & 0xff, 64);
  const thatPhase = beatsin8_t(7 + s.aux0, -64 & 0xff, 64);
  for (let i = 0; i < s.vLength; i++) {
    const colorIndex =
      Math.floor(cubicwave8((i * (2 + 3 * (s.speed >> 5)) + thisPhase) & 0xff) / 2) +
      Math.floor(cos8_t((i * (1 + 2 * (s.speed >> 5)) + thatPhase) & 0xff) / 2);
    const thisBright = qsub8(colorIndex, beatsin8_t(7, 0, 128 - (s.intensity >> 1)));
    s.setPixelColor(i, s.color_from_palette(colorIndex, false, SOLID_WRAP(s), 0, thisBright));
  }
}

export function mode_percent(s: Segment) {
  const SEGLEN = s.vLength;
  const percent = constrain(s.intensity, 0, 200);
  const activeLeds = percent < 100 ? Math.round((SEGLEN * percent) / 100) : Math.round((SEGLEN * (200 - percent)) / 100);
  let size = 1 + ((s.speed * SEGLEN) >> 11);
  if (s.speed === 255) size = 255;
  if (percent <= 100) {
    for (let i = 0; i < SEGLEN; i++) {
      if (i < s.aux1) s.setPixelColor(i, s.check1 ? s.color_from_palette(map(percent, 0, 100, 0, 255), false, false, 0) : s.color_from_palette(i, true, SOLID_WRAP(s), 0));
      else s.setPixelColor(i, s.getCurrentColor(1));
    }
  } else {
    for (let i = 0; i < SEGLEN; i++) {
      if (i < SEGLEN - s.aux1) s.setPixelColor(i, s.getCurrentColor(1));
      else s.setPixelColor(i, s.check1 ? s.color_from_palette(map(percent, 100, 200, 255, 0), false, false, 0) : s.color_from_palette(i, true, SOLID_WRAP(s), 0));
    }
  }
  if (activeLeds > s.aux1) {
    s.aux1 += size;
    if (s.aux1 > activeLeds) s.aux1 = activeLeds;
  } else if (activeLeds < s.aux1) {
    if (s.aux1 > size) s.aux1 -= size;
    else s.aux1 = 0;
    if (s.aux1 < activeLeds) s.aux1 = activeLeds;
  }
}

export function mode_heartbeat(s: Segment) {
  const bpm = 40 + (s.speed >> 3);
  const msPerBeat = Math.floor(60000 / bpm);
  const secondBeat = Math.floor(msPerBeat / 3);
  let briLower = s.aux1;
  const beatTimer = (s.now - s.step) >>> 0;
  briLower = Math.floor((briLower * 2042) / (2048 + s.intensity));
  s.aux1 = briLower;
  if (beatTimer > secondBeat && !s.aux0) {
    s.aux1 = 0xffff;
    s.aux0 = 1;
  }
  if (beatTimer > msPerBeat) {
    s.aux1 = 0xffff;
    s.aux0 = 0;
    s.step = s.now;
  }
  for (let i = 0; i < s.vLength; i++)
    s.setPixelColor(i, color_blend(s.color_from_palette(i, true, SOLID_WRAP(s), 0), s.getCurrentColor(1), u8(255 - (s.aux1 >> 8))));
}

const pacifica1 = palette16(0x002229, 0x001e2f, 0x001934, 0x001938, 0x00143f, 0x001443, 0x00b047, 0x00b04c, 0x00004f, 0x000054, 0x000062, 0x00006f, 0x00007a, 0x000085, 0x47938a, 0x64d08e);
const pacifica2 = palette16(0x002229, 0x001e2f, 0x001934, 0x001938, 0x00143f, 0x001443, 0x00b047, 0x00b04c, 0x00004f, 0x000054, 0x000062, 0x00006f, 0x00007a, 0x000085, 0x369b90, 0x4fdc9b);
const pacifica3 = palette16(0x00142c, 0x00193b, 0x002247, 0x002551, 0x002c5a, 0x002f63, 0x00346b, 0x003671, 0x003b78, 0x003f7f, 0x00478e, 0x004d9c, 0x0054a9, 0x005ab4, 0x3f7fdc, 0x5a9cff);
function pacifica_one_layer(s: Segment, i: number, p: Palette16, cistart: number, wavescale: number, bri: number, ioff: number): number {
  let ci = cistart;
  let waveangle = ioff;
  const half = (wavescale >> 1) + 20;
  waveangle += (120 + s.intensity) * i;
  const s16 = (sin16_t(waveangle) + 32768) >>> 0;
  const cs = scale16(s16, half) + half;
  ci += cs * i;
  const sindex16 = (sin16_t(ci) + 32768) >>> 0;
  const sindex8 = scale16(sindex16, 240);
  return ColorFromPalette(p, sindex8, bri, LINEARBLEND);
}
const addRGB = (a: number, b: number) => RGBW32(qadd8(R(a), R(b)), qadd8(G(a), G(b)), qadd8(B(a), B(b)));
export function mode_pacifica(s: Segment) {
  const p1 = s.paletteId ? s.currentPalette : pacifica1;
  const p2 = s.paletteId ? s.currentPalette : pacifica2;
  const p3 = s.paletteId ? s.currentPalette : pacifica3;
  let c1 = s.aux0;
  let c2 = s.aux1;
  let c3 = s.step & 0xffff;
  let c4 = s.step >>> 16;
  const ft = s.frametime;
  const deltams = (ft >> 2) + ((ft * s.speed) >> 7);
  const f1 = beatsin16_t(3, 179, 269);
  const f2 = beatsin16_t(4, 179, 269);
  const d1 = Math.floor((deltams * f1) / 256);
  const d2 = Math.floor((deltams * f2) / 256);
  const d21 = Math.floor((d1 + d2) / 2);
  c1 = (c1 + d1 * beatsin88_t(1011, 10, 13)) >>> 0;
  c2 = (c2 - d21 * beatsin88_t(777, 8, 11)) >>> 0;
  c3 = (c3 - d1 * beatsin88_t(501, 5, 7)) >>> 0;
  c4 = (c4 - d2 * beatsin88_t(257, 4, 6)) >>> 0;
  s.aux0 = c1;
  s.aux1 = c2;
  s.step = (((c4 & 0xffff) << 16) | (c3 & 0xffff)) >>> 0;
  const basethreshold = beatsin8_t(9, 55, 65);
  let wave = beat8(7);
  for (let i = 0; i < s.vLength; i++) {
    let c = RGBW32(2, 6, 10);
    c = addRGB(c, pacifica_one_layer(s, i, p1, c1, beatsin16_t(3, 11 * 256, 14 * 256), beatsin8_t(10, 70, 130), u16(0 - beat16(301))));
    c = addRGB(c, pacifica_one_layer(s, i, p2, c2, beatsin16_t(4, 6 * 256, 9 * 256), beatsin8_t(17, 40, 80), beat16(401)));
    c = addRGB(c, pacifica_one_layer(s, i, p3, c3, 6 * 256, beatsin8_t(9, 10, 38), u16(0 - beat16(503))));
    c = addRGB(c, pacifica_one_layer(s, i, p3, c4, 5 * 256, beatsin8_t(8, 10, 28), beat16(601)));
    const threshold = scale8(sin8_t(wave), 20) + basethreshold;
    wave = u8(wave + 7);
    const l = Math.floor(((R(c) + G(c) + B(c)) * 21846) / 65536);
    if (l > threshold) {
      const overage = l - threshold;
      const overage2 = qadd8(overage, overage);
      c = addRGB(c, RGBW32(overage, overage2, qadd8(overage2, overage2)));
    }
    s.setPixelColor(i, c);
  }
}

export function mode_sunrise(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  if (s.call === 0 || s.speed !== s.aux0) {
    s.step = s.now;
    s.aux0 = s.speed;
  }
  s.fill(BLACK);
  let stage = 0xffff;
  let s10SinceStart = Math.floor((s.now - s.step) / 100);
  if (s.speed > 120) {
    const counter = mul32(s.now >>> 1, ((s.speed - 120) >> 1) + 1);
    stage = triwave16(counter);
  } else if (s.speed) {
    let durMins = s.speed;
    if (durMins > 60) durMins -= 60;
    const s10Target = durMins * 600;
    if (s10SinceStart > s10Target) s10SinceStart = s10Target;
    stage = map(s10SinceStart, 0, s10Target, 0, 0xffff);
    if (s.speed > 60) stage = 0xffff - stage;
  }
  for (let i = 0; i <= SEGLEN / 2; i++) {
    let wave = triwave16(Math.floor((i * stage) / SEGLEN));
    wave = (wave >> 8) + ((wave * s.intensity) >> 15);
    const c = wave > 240 ? s.color_from_palette(240, false, true, 255) : s.color_from_palette(wave, false, true, 255);
    s.setPixelColor(i, c);
    s.setPixelColor(SEGLEN - i - 1, c);
  }
}

function phased_base(s: Segment, moder: number) {
  const SEGLEN = s.vLength;
  const allfreq = 16;
  if (!s.state) s.state = { phase: 0 };
  const st = s.state as { phase: number };
  const cutOff = 255 - s.intensity;
  let modVal = 5;
  let index = Math.floor(s.now / 64);
  st.phase = Math.fround(st.phase + s.speed / 32);
  for (let i = 0; i < SEGLEN; i++) {
    if (moder === 1) modVal = Math.floor(perlin8(i * 10 + i * 10) / 16);
    let val = (i + 1) * allfreq;
    if (modVal === 0) modVal = 1;
    val = Math.trunc(val + (st.phase * ((i % modVal) + 1)) / 2) >>> 0;
    let b = cubicwave8(val);
    b = b > cutOff ? b - cutOff : 0;
    s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(index, false, false, 0), b));
    index += Math.floor(256 / SEGLEN);
    if (SEGLEN > 256) index++;
  }
}
export const mode_phased = (s: Segment) => phased_base(s, 0);
export const mode_phased_noise = (s: Segment) => phased_base(s, 1);

export function mode_twinkleup(s: Segment) {
  const prevSeed = prng.getSeed();
  prng.setSeed(535);
  for (let i = 0; i < s.vLength; i++) {
    const ranstart = prng.random8();
    let pixBri = sin8_t(ranstart + Math.floor((16 * s.now) / (256 - s.speed)));
    if (prng.random8() > s.intensity) pixBri = 0;
    s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(u16(prng.random8() + Math.floor(s.now / 100)), false, SOLID_WRAP(s), 0), pixBri));
  }
  prng.setSeed(prevSeed);
}

export function mode_noisepal(s: Segment) {
  const scale = 15 + (s.intensity >> 2);
  if (!s.state) s.state = [new Uint32Array(16), new Uint32Array(16)];
  const pals = s.state as Palette16[];
  const changePaletteMs = 4000 + s.speed * 10;
  if ((s.now - s.step) >>> 0 > changePaletteMs) {
    s.step = s.now;
    const baseI = hw_random8();
    const minBri = gamma8inv(128);
    pals[1] = palette16(
      CHSV(baseI + hw_random8(64), 255, hw_random8(minBri, 255)),
      CHSV(baseI + 128, 255, hw_random8(minBri, 255)),
      CHSV(baseI + hw_random8(92), 192, hw_random8(minBri, 255)),
      CHSV(baseI + hw_random8(92), 255, hw_random8(minBri, 255)),
    );
  }
  nblendPaletteTowardPalette(pals[0]!, pals[1]!, 48);
  if (s.paletteId > 0) pals[0]!.set(s.currentPalette);
  for (let i = 0; i < s.vLength; i++) {
    const index = perlin8(i * scale, s.aux0 + i * scale);
    s.setPixelColor(i, ColorFromPalette(pals[0]!, index, 255, LINEARBLEND));
  }
  s.aux0 += beatsin8_t(10, 1, 4);
}

export function mode_sinewave(s: Segment) {
  const colorIndex = Math.floor(s.now / 32);
  s.step += Math.floor(s.speed / 16);
  const freq = Math.floor(s.intensity / 4);
  for (let i = 0; i < s.vLength; i++) {
    const pixBri = cubicwave8(i * freq + s.step);
    s.setPixelColor(i, color_blend(s.getCurrentColor(1), s.color_from_palette(u16(Math.floor((i * colorIndex) / 255)), false, SOLID_WRAP(s), 0), pixBri));
  }
}

export function mode_flow(s: Segment) {
  const SEGLEN = s.vLength;
  let counter = 0;
  if (s.speed !== 0) counter = mul32(s.now, (s.speed >> 2) + 1) >>> 8;
  const maxZones = Math.floor(SEGLEN / 6);
  let zones = (s.intensity * maxZones) >> 8;
  if (zones & 1) zones++;
  if (zones < 2) zones = 2;
  const zoneLen = Math.floor(SEGLEN / zones);
  const requiredZones = Math.floor((SEGLEN + zoneLen - 1) / zoneLen);
  zones = requiredZones + 2;
  const offset = Math.trunc((SEGLEN - zones * zoneLen) / 2);
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen;
    for (let i = 0; i < zoneLen; i++) {
      const colorIndex = (Math.floor((i * 255) / zoneLen) - counter) >>> 0;
      let led = z & 1 ? i : zoneLen - 1 - i;
      if (s.reverse) led = zoneLen - 1 - led;
      s.setPixelColor(pos + led, s.color_from_palette(colorIndex, false, true, 255));
    }
  }
}

export function mode_chunchun(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  s.fade_out(254);
  let counter = mul32(s.now, 6 + (s.speed >> 4));
  const numBirds = 2 + (SEGLEN >> 3);
  const span = Math.floor((s.intensity << 8) / numBirds);
  for (let i = 0; i < numBirds; i++) {
    counter = (counter - span) >>> 0;
    const megumin = (sin16_t(counter) + 0x8000) >>> 0;
    const bird = constrain(Math.floor((megumin * SEGLEN) / 65536), 0, SEGLEN - 1);
    s.setPixelColor(bird, s.color_from_palette(Math.floor((i * 255) / numBirds), false, false, 0));
  }
}

const SPOT_MAX_COUNT = 49;
export function mode_dancing_shadows(s: Segment) {
  const SEGLEN = s.vLength;
  if (SEGLEN <= 1) return mode_static(s);
  const numSpotlights = map(s.intensity, 0, 255, 2, SPOT_MAX_COUNT);
  const initialize = s.aux0 !== numSpotlights || !s.state;
  s.aux0 = numSpotlights;
  type Spot = { speed: number; colorIdx: number; position: number; lastUpdateTime: number; width: number; type: number };
  if (initialize) s.state = Array.from({ length: numSpotlights }, (): Spot => ({ speed: 0, colorIdx: 0, position: 0, lastUpdateTime: 0, width: 0, type: 0 }));
  const spots = s.state as Spot[];
  s.fill(BLACK);
  const time = s.now;
  let respawn = false;
  for (const sp of spots) {
    if (!initialize) {
      const delta = Math.trunc((time - sp.lastUpdateTime) * (sp.speed * ((1 + s.speed) / 100)));
      if (Math.abs(delta) >= 1) {
        sp.position = (((sp.position + delta) << 16) >> 16);
        sp.lastUpdateTime = time;
      }
      respawn = (sp.speed > 0 && sp.position > SEGLEN + 2) || (sp.speed < 0 && sp.position < -(sp.width + 2));
    }
    if (initialize || respawn) {
      sp.colorIdx = hw_random8();
      sp.width = hw_random8(1, 10);
      sp.speed = 1 / hw_random8(4, 50);
      if (initialize) {
        sp.position = hw_random16(SEGLEN);
        sp.speed *= hw_random8(2) ? 1 : -1;
      } else if (hw_random8(2)) {
        sp.position = SEGLEN + sp.width;
        sp.speed *= -1;
      } else sp.position = -sp.width;
      sp.lastUpdateTime = time;
      sp.type = hw_random8(6);
    }
    const color = s.color_from_palette(sp.colorIdx, false, false, 255);
    const start = sp.position;
    const put = (j: number, amt: number) => {
      if (start + j >= 0 && start + j < SEGLEN) s.blendPixelColor(start + j, color, amt);
    };
    if (sp.width <= 1) put(0, 128);
    else {
      switch (sp.type) {
        case 0: for (let j = 0; j < sp.width; j++) put(j, 128); break;
        case 1: for (let j = 0; j < sp.width; j++) put(j, cubicwave8(map(j, 0, sp.width - 1, 0, 255))); break;
        case 2: for (let j = 0; j < sp.width; j++) put(j, cubicwave8(2 * map(j, 0, sp.width - 1, 0, 255))); break;
        case 3: for (let j = 0; j < sp.width; j += 2) put(j, 128); break;
        case 4: for (let j = 0; j < sp.width; j += 3) put(j, 128); break;
        case 5: for (let j = 0; j < sp.width; j += 4) put(j, 128); break;
      }
    }
  }
}

export function mode_washing_machine(s: Segment) {
  const SEGLEN = s.vLength;
  const speed = tristate_square8(s.now >>> 7, 90, 15);
  s.step = (s.step + Math.trunc((speed * 2048) / (512 - s.speed))) >>> 0;
  for (let i = 0; i < SEGLEN; i++) {
    const col = sin8_t(Math.floor(((Math.floor(s.intensity / 25) + 1) * 255 * i) / SEGLEN) + (s.step >>> 7));
    s.setPixelColor(i, s.color_from_palette(col, false, SOLID_WRAP(s), 3));
  }
}

export function mode_blends(s: Segment) {
  const SEGLEN = s.vLength;
  const pixelLen = Math.min(SEGLEN, 255);
  s.allocateData(4 * (pixelLen + 1));
  const pixels = new Uint32Array(s.data.buffer, 0, pixelLen + 1);
  const blendSpeed = map(s.intensity, 0, 255, 10, 128);
  let shift = mul32(s.now, (s.speed >> 3) + 1) >>> 8;
  for (let i = 0; i < pixelLen; i++) {
    pixels[i] = color_blend(pixels[i]!, s.color_from_palette(u16(shift + quadwave8((i + 1) * 16)), false, SOLID_WRAP(s), 255), blendSpeed);
    shift += 3;
  }
  let offset = 0;
  for (let i = 0; i < SEGLEN; i++) {
    s.setPixelColor(i, pixels[offset++]!);
    if (offset >= pixelLen) offset = 0;
  }
}

export function mode_tv_simulator(s: Segment) {
  type Tv = {
    totalTime: number; fadeTime: number; startTime: number; elapsed: number; sliderValues: number;
    sceeneStart: number; sceeneDuration: number; hue: number; sat: number; bri: number;
    r: number; g: number; b: number; pr: number; pg: number; pb: number;
  };
  if (!s.state)
    s.state = { totalTime: 0, fadeTime: 0, startTime: 0, elapsed: 0, sliderValues: 0, sceeneStart: 0, sceeneDuration: 0, hue: 0, sat: 0, bri: 0, r: 0, g: 0, b: 0, pr: 0, pg: 0, pb: 0 } satisfies Tv;
  const tv = s.state as Tv;
  const colorSpeed = map(s.speed, 0, 255, 1, 20);
  const colorIntensity = map(s.intensity, 0, 255, 10, 30);
  const sliders = ((s.speed << 8) | s.intensity) & 0xffff;
  if (sliders !== tv.sliderValues) {
    tv.sliderValues = sliders;
    s.aux1 = 0;
  }
  if ((s.now - tv.sceeneStart) >>> 0 >= tv.sceeneDuration || s.aux1 === 0) {
    tv.sceeneStart = s.now;
    tv.sceeneDuration = hw_random16(60 * 250 * colorSpeed, 60 * 750 * colorSpeed);
    tv.hue = hw_random16(0, 768);
    tv.sat = hw_random8(100, 130 + colorIntensity);
    tv.bri = hw_random8(200, 240);
    s.aux1 = 1;
    s.aux0 = 0;
  }
  if (s.aux0 === 0) {
    let j = hw_random8(4 * colorIntensity);
    const hue =
      hw_random8() < 128
        ? j < tv.hue ? tv.hue - j : 767 - tv.hue - j
        : j + tv.hue < 767 ? tv.hue + j : tv.hue + j - 767;
    j = hw_random8(2 * colorIntensity);
    const sat = tv.sat - j < 0 ? 0 : tv.sat - j;
    j = hw_random8(100);
    const bri = tv.bri - j < 0 ? 0 : tv.bri - j;
    const n = (hue >> 8) % 3;
    const x = u8(((((hue & 255) * sat) >> 8) * bri) >> 8);
    const sv = u8(((256 - sat) * bri) >> 8);
    const temp = [sv, u8(x + sv), u8(bri - x), sv, u8(x + sv)];
    tv.r = temp[n + 2]!;
    tv.g = temp[n + 1]!;
    tv.b = temp[n]!;
  }
  const nr = tv.r * 257;
  const ng = tv.g * 257;
  const nb = tv.b * 257;
  if (s.aux0 === 0) {
    s.aux0 = 1;
    tv.totalTime = hw_random16(250, 2500);
    tv.fadeTime = hw_random16(0, tv.totalTime);
    if (hw_random8(10) < 3) tv.fadeTime = 0;
    tv.startTime = s.now;
  }
  tv.elapsed = (s.now - tv.startTime) >>> 0;
  let r = nr;
  let g = ng;
  let b = nb;
  if (tv.elapsed < tv.fadeTime) {
    r = map(tv.elapsed, 0, tv.fadeTime, tv.pr, nr);
    g = map(tv.elapsed, 0, tv.fadeTime, tv.pg, ng);
    b = map(tv.elapsed, 0, tv.fadeTime, tv.pb, nb);
  }
  s.fill(RGBW32(r >> 8, g >> 8, b >> 8));
  if (tv.elapsed >= tv.totalTime) {
    tv.pr = nr;
    tv.pg = ng;
    tv.pb = nb;
    s.aux0 = 0;
  }
}

export const moreEffects: Registry = {
  44: mode_tetrix,
  48: mode_rolling_balls,
  80: mode_twinklefox,
  81: mode_twinklecat,
  82: mode_halloween_eyes,
  83: mode_static_pattern,
  84: mode_tri_static_pattern,
  85: mode_spots,
  86: mode_spots_fade,
  87: mode_glitter,
  88: mode_candle,
  89: mode_starburst,
  90: mode_exploding_fireworks,
  91: mode_bouncing_balls,
  92: mode_sinelon,
  93: mode_sinelon_dual,
  94: mode_sinelon_rainbow,
  95: mode_popcorn,
  96: mode_drip,
  97: mode_plasma,
  98: mode_percent,
  99: mode_ripple_rainbow,
  100: mode_heartbeat,
  101: mode_pacifica,
  102: mode_candle_multi,
  103: mode_solid_glitter,
  104: mode_sunrise,
  105: mode_phased,
  106: mode_twinkleup,
  107: mode_noisepal,
  108: mode_sinewave,
  109: mode_phased_noise,
  110: mode_flow,
  111: mode_chunchun,
  112: mode_dancing_shadows,
  113: mode_washing_machine,
  115: mode_blends,
  116: mode_tv_simulator,
  151: mode_pacman,
};
