import type { PaletteStop } from "./schemas.js";

/** WLED shows custom palette file /paletteN.json as palette ID 255 - N. */
export const customPaletteId = (slot: number) => 255 - slot;
export const paletteFileName = (slot: number) => `/palette${slot}.json`;

export interface WledPaletteFile {
  palette: (number | string)[];
}

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

const sortStops = (stops: PaletteStop[]) => [...stops].sort((a, b) => a.pos - b.pos);

/** Library stops -> WLED palette file contents (flat [pos, r, g, b, ...]). */
export function stopsToWled(stops: PaletteStop[]): WledPaletteFile {
  return { palette: sortStops(stops).flatMap((s) => [s.pos, ...toRgb(s.color)]) };
}

/** WLED palette file -> library stops. Accepts both the numeric form and the [pos, "rrggbb", ...] hex form. */
export function wledToStops(file: WledPaletteFile): PaletteStop[] {
  const p = file.palette;
  const stops: PaletteStop[] = [];
  let i = 0;
  while (i < p.length) {
    const pos = Number(p[i]);
    const next = p[i + 1];
    if (typeof next === "string") {
      stops.push({ pos, color: `#${next.toLowerCase()}` });
      i += 2;
    } else {
      stops.push({ pos, color: toHex(Number(p[i + 1]), Number(p[i + 2]), Number(p[i + 3])) });
      i += 4;
    }
  }
  return sortStops(stops);
}
