import { sin8_t } from "../math.js";
import type { EffectFn, Segment } from "../segment.js";

export type Registry = Record<number, EffectFn>;

/** paletteBlend: 0 wrap when moving, 1 always wrap, 2 never wrap, 3 no blending. */
export const SOLID_WRAP = (s: Segment) => s.strip.paletteBlend === 1 || s.strip.paletteBlend === 3;
export const MOVING_WRAP = (s: Segment) => !(s.strip.paletteBlend === 2 || (s.strip.paletteBlend === 0 && s.speed === 0));

export function sin_gap(x: number): number {
  x &= 0xffff;
  if (x & 0x100) return 0;
  return sin8_t(x + 192);
}

/** Tristate square wave with attack & decay: signed -127..127. */
export function tristate_square8(x: number, pulsewidth: number, attdec: number): number {
  x &= 0xff;
  let a = 127;
  if (x > 127) {
    a = -127;
    x -= 127;
  }
  if (x < attdec) return Math.trunc((x * a) / attdec);
  if (x < pulsewidth - attdec) return a;
  if (x < pulsewidth) return Math.trunc(((pulsewidth - x) * a) / attdec);
  return 0;
}

/** C float -> uint8 cast for values known to be in range, truncating toward zero. */
export const toU8 = (f: number) => Math.trunc(f) & 0xff;
