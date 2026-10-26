import type { WledColor } from "@wled-manager/shared";

/** Normalizes a WLED color to [r, g, b, w?]. Hex strings are "RRGGBB" or "WWRRGGBB". */
export function toChannels(c: WledColor | undefined): number[] {
  if (c === undefined) return [0, 0, 0];
  if (Array.isArray(c)) return [...c];
  const hex = c.replace(/^#/, "");
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) || 0;
  return hex.length === 8 ? [n(2), n(4), n(6), n(0)] : [n(0), n(2), n(4)];
}

export const channelsToHex = (ch: number[]) =>
  "#" + ch.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

export function hexToChannels(hex: string, white?: number): WledColor {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  return white === undefined ? [...rgb] : [...rgb, white];
}

/** CSS preview of an RGBW color (white blended in). */
export function colorCss(c: WledColor | undefined): string {
  const [r = 0, g = 0, b = 0, w = 0] = toChannels(c);
  const mix = (v: number) => Math.min(255, v + w);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
