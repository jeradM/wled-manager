import type { Segment, WledColor } from "./schemas.js";

/** A run of lights in one repeat of a pattern: `count` LEDs of `color`, or dark when it's null. */
export type PatternRun = { count: number; color: WledColor | null };

/** WLED's limits on grouping and spacing. */
export const MAX_GROUPING = 255;
export const MAX_SPACING = 255;

/** LEDs in one repeat. */
export const patternLength = (runs: PatternRun[]) => runs.reduce((n, r) => n + Math.max(0, r.count), 0);

/** Why the pattern can't be made into segments, or null when it can. */
export function patternProblem(runs: PatternRun[], start: number, stop: number): string | null {
  const length = patternLength(runs);
  if (!runs.some((r) => r.color && r.count > 0)) return "Add at least one colored run";
  if (runs.some((r) => !Number.isInteger(r.count) || r.count < 0)) return "Runs need a whole number of LEDs";
  if (stop <= start) return "Stop LED must be after the start LED";
  const long = runs.find((r) => r.color && r.count > MAX_GROUPING);
  if (long) return `A colored run can be at most ${MAX_GROUPING} LEDs`;
  const spaced = runs.find((r) => r.color && r.count > 0 && length - r.count > MAX_SPACING);
  if (spaced) return `Each colored run must repeat within ${MAX_SPACING} LEDs of itself; this repeat is ${length} LEDs long`;
  return null;
}

const sameColor = (a: WledColor | null, b: WledColor | null) => JSON.stringify(a) === JSON.stringify(b);

/** A segment's share of one repeat: LEDs `from`–`to` (inclusive, within the repeat) in `color`; null paints black. */
type Paint = { from: number; to: number; color: WledColor | null };

/**
 * The fewest overlapping paints that make one repeat, bottom first: each later paint covers the ones below it,
 * as later WLED segments draw over earlier ones. Dark LEDs are free where nothing covers them; inside a paint
 * they need a black paint on top. Found as in the "strange printer" problem, over runs of one color: a run can
 * extend the paint of an earlier run of its color, with the runs between painted on top. No paint spans more
 * than `maxSpan` LEDs.
 */
function planPaints(runs: PatternRun[], maxSpan: number): Paint[] {
  // Runs of one color, merged, with where each starts and ends in the repeat.
  const merged: { color: WledColor | null; from: number; to: number }[] = [];
  let at = 0;
  for (const r of runs) {
    if (r.count <= 0) continue;
    const last = merged[merged.length - 1];
    if (last && sameColor(last.color, r.color)) last.to += r.count;
    else merged.push({ color: r.color, from: at, to: at + r.count - 1 });
    at += r.count;
  }
  const n = merged.length;
  const span = (i: number, j: number) => merged[j]!.to - merged[i]!.from + 1;
  // cost[i][j]: paints for runs i–j with every LED painted; via[i][j]: -1 paints run j alone, k extends run k's paint.
  const cost = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const via = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  const c = (i: number, j: number) => (i > j ? 0 : cost[i]![j]!);
  for (let len = 1; len <= n; len++)
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      let best = c(i, j - 1) + 1;
      let how = -1;
      if (span(i, j) <= maxSpan)
        for (let k = i; k < j; k++)
          if (sameColor(merged[k]!.color, merged[j]!.color) && c(i, k) + c(k + 1, j - 1) < best) {
            best = c(i, k) + c(k + 1, j - 1);
            how = k;
          }
      cost[i]![j] = best;
      via[i]![j] = how;
    }
  const paints = (i: number, j: number): Paint[] => {
    if (i > j) return [];
    const k = via[i]![j]!;
    if (k === -1) return [...paints(i, j - 1), { from: merged[j]!.from, to: merged[j]!.to, color: merged[j]!.color }];
    // Stretch whatever shows on run k over to run j, then paint the runs between on top.
    const below = paints(i, k).map((p) => ({ ...p }));
    const top = below.findLastIndex((p) => p.from <= merged[k]!.from && merged[k]!.to <= p.to);
    below[top]!.to = merged[j]!.to;
    return [...below, ...paints(k + 1, j - 1)];
  };
  // Split the repeat into stretches painted throughout, leaving dark runs between them uncovered for free.
  const total = new Array<number>(n + 1).fill(0);
  const cut = new Array<number>(n + 1).fill(-1);
  for (let j = 1; j <= n; j++) {
    total[j] = merged[j - 1]!.color ? Infinity : total[j - 1]!;
    for (let i = 0; i < j; i++)
      if (total[i]! + c(i, j - 1) < total[j]!) {
        total[j] = total[i]! + c(i, j - 1);
        cut[j] = i;
      }
  }
  const out: Paint[] = [];
  for (let j = n; j > 0; ) {
    const i = cut[j]!;
    if (i === -1) j--;
    else {
      out.unshift(...paints(i, j - 1));
      j = i;
    }
  }
  return out;
}

/** One paint per colored run: always within WLED's limits when `patternProblem` passes. */
function runPaints(runs: PatternRun[]): Paint[] {
  const out: Paint[] = [];
  let at = 0;
  for (const r of runs) {
    if (r.color && r.count > 0) out.push({ from: at, to: at + r.count - 1, color: r.color });
    at += Math.max(0, r.count);
  }
  return out;
}

const BLACK: WledColor = [0, 0, 0];

/**
 * Segments that repeat the pattern over start–stop, as few as overlapping allows: each paints a stretch of one
 * repeat, grouping its LEDs as one pixel and spacing the rest of the repeat, so it lands on the same stretch of
 * every repeat. Later segments draw over earlier ones (C1 under C2 under C3 makes C1 C2 C3 C2 C1 from three).
 * Dark LEDs are left out where possible, or painted black. Segments get Solid on top (blend mode Top, so a
 * controller segment they replace doesn't keep its own), named "name n".
 */
export function patternSegments(runs: PatternRun[], start: number, stop: number, name = "Pattern"): Segment[] {
  if (patternProblem(runs, start, stop)) return [];
  const length = patternLength(runs);
  const fits = (p: Paint) => p.to - p.from + 1 <= MAX_GROUPING && length - (p.to - p.from + 1) <= MAX_SPACING;
  let paints = planPaints(runs, MAX_GROUPING);
  if (!paints.every(fits)) paints = runPaints(runs);
  const rgbw = runs.some((r) => Array.isArray(r.color) && r.color.length === 4);
  const out: Segment[] = paints
    .filter((p) => start + p.from < stop)
    .map((p) => ({
      start: start + p.from,
      stop,
      grp: p.to - p.from + 1,
      spc: length - (p.to - p.from + 1),
      of: 0,
      bm: 0,
      fx: 0,
      fxName: "Solid",
      col: [structuredClone(p.color ?? (rgbw ? [0, 0, 0, 0] : BLACK))],
      pal: 0,
    }));
  return out.map((s, i) => ({ n: out.length > 1 ? `${name} ${i + 1}` : name, ...s }));
}
