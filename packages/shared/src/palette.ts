import type { PaletteStop, PaletteVariant } from "./schemas.js";
import type { ResolvedSegment } from "./segments.js";

/**
 * Custom palette file /paletteN.json appears on the device as palette ID base - N. Older firmware
 * (and forks such as QuinLED's) use base 255; upstream WLED main uses base 200.
 */
export const customPaletteId = (slot: number, base = 255) => base - slot;
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

/** CSS linear-gradient for a palette preview. */
export function stopsToCss(stops: PaletteStop[]): string {
  const sorted = sortStops(stops);
  if (sorted.length === 1) return sorted[0]!.color;
  return `linear-gradient(to right, ${sorted.map((s) => `${s.color} ${((s.pos / 255) * 100).toFixed(1)}%`).join(", ")})`;
}

/** Normalized form for comparing palette contents regardless of WLED file encoding (hex vs numeric). */
export function paletteKey(stops: PaletteStop[]): string {
  return sortStops(stops)
    .map((s) => `${s.pos}:${s.color.toLowerCase()}`)
    .join(",");
}

/**
 * One entry of /json/palx: either gradient stops [[pos, r, g, b], ...] or color tokens
 * ("r" random, "c1".."c3" segment colors) for palettes derived from the segment's colors.
 */
export type PalxEntry = [number, number, number, number][] | string[];

/** Built-in palette stops from a /json/palx entry, or null for token-based palettes that can't be imported. */
export function palxToStops(entry: PalxEntry): PaletteStop[] | null {
  if (entry.length === 0 || typeof entry[0] === "string") return null;
  return (entry as [number, number, number, number][]).map(([pos, r, g, b]) => ({ pos, color: toHex(r, g, b) }));
}

/** The stops a controller gets: its own version of the palette if it has one. */
export const paletteStopsFor = (p: { stops: PaletteStop[]; variants?: PaletteVariant[] }, controllerId: string) =>
  p.variants?.find((v) => v.controllerId === controllerId)?.stops ?? p.stops;

/**
 * Palette position (0-255) of an LED when a palette is spread along a run of LEDs, as WLED effects such as
 * "Palette" do: LED i of n gets i * 255 / n, counted from the run's start (its end when reversed).
 */
export function palettePosition(led: number, run: Pick<ResolvedSegment, "start" | "stop" | "rev">): number | undefined {
  if (led < run.start || led >= run.stop) return undefined;
  const length = run.stop - run.start;
  const i = run.rev ? run.stop - 1 - led : led - run.start;
  return Math.floor((i * 255) / length);
}

/** The LED of a run that shows a palette position: the inverse of palettePosition. */
export function ledAtPosition(pos: number, run: Pick<ResolvedSegment, "start" | "stop" | "rev">): number {
  const length = run.stop - run.start;
  const i = Math.min(length - 1, Math.max(0, Math.ceil((pos * length) / 255)));
  return run.rev ? run.stop - 1 - i : run.start + i;
}
