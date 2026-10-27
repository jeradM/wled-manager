import type { LedMarker, LedRange, LedSpan, PresetState, Segment, SegmentPlanEntry } from "./schemas.js";

/**
 * A plan entry turned into WLED geometry: LEDs start..stop-1, running backwards when rev is set, lit in
 * groups of grp LEDs with spc LEDs off after each group, the effect shifted by of.
 */
export interface ResolvedSegment {
  name?: string;
  start: number;
  stop: number;
  rev: boolean;
  grp: number;
  spc: number;
  of: number;
}

export type SegmentResolution = { ok: true; segment: ResolvedSegment } | { ok: false; error: string };

/** What plan entries are resolved against: a controller's labelled LEDs and its LED count. */
export interface SegmentContext {
  markers: LedMarker[];
  ranges: LedRange[];
  ledCount: number;
}

/**
 * WLED saves {"stop": 0} entries for unused segment slots; loading the preset clears those segments.
 * They carry no settings of their own.
 */
export const isClearMarker = (s: Segment) => s.stop === 0 && Object.keys(s).every((k) => k === "stop" || k === "id");

export const isRangeEntry = (e: SegmentPlanEntry): e is Extract<SegmentPlanEntry, { range: string }> => "range" in e;

/** LED indices as sorted runs of consecutive LEDs. */
export function indicesToSpans(indices: Iterable<number>): LedSpan[] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const spans: LedSpan[] = [];
  for (const i of sorted) {
    const last = spans.at(-1);
    if (last && last.stop === i) last.stop = i + 1;
    else spans.push({ start: i, stop: i + 1 });
  }
  return spans;
}

export function spansToIndices(spans: LedSpan[]): number[] {
  return spans.flatMap((s) => Array.from({ length: s.stop - s.start }, (_, k) => s.start + k));
}

/** LEDs a segment actually lights: grouping and spacing repeat from its start. */
export function litLeds(s: Pick<ResolvedSegment, "start" | "stop" | "grp" | "spc">): number[] {
  const period = s.grp + s.spc;
  const out: number[] = [];
  for (let p = 0; p < s.stop - s.start; p++) if (p % period < s.grp) out.push(s.start + p);
  return out;
}

/** Pixels an effect sees on the segment: one per group (WLED's virtual length). */
export const virtualLength = (s: Pick<ResolvedSegment, "start" | "stop" | "grp" | "spc">) =>
  Math.ceil((s.stop - s.start) / (s.grp + s.spc));

/**
 * Resolves a plan entry against a controller's markers and ranges. A start/end segment runs from its
 * start towards its end, so an end before the start gives a reversed segment whose effects still flow
 * from the start.
 */
export function resolveSegment(entry: SegmentPlanEntry, ctx: SegmentContext): SegmentResolution {
  const geometry = resolveGeometry(entry, ctx);
  if (!geometry.ok) return geometry;
  const { first, last, rev } = geometry;
  if (first < 0 || last >= ctx.ledCount)
    return { ok: false, error: `Runs past the ends of the strip (LEDs 0–${ctx.ledCount - 1})` };
  return {
    ok: true,
    segment: {
      ...(entry.name ? { name: entry.name } : {}),
      start: first,
      stop: last + 1,
      rev,
      grp: entry.grp ?? 1,
      spc: entry.spc ?? 0,
      of: entry.of ?? 0,
    },
  };
}

type Geometry = { ok: true; first: number; last: number; rev: boolean } | { ok: false; error: string };

function resolveGeometry(entry: SegmentPlanEntry, { markers, ranges }: SegmentContext): Geometry {
  if (isRangeEntry(entry)) {
    const range = ranges.find((r) => r.label === entry.range);
    if (!range) return { ok: false, error: `No range labelled "${entry.range}"` };
    const span = range.spans[entry.span];
    if (!span) return { ok: false, error: `"${entry.range}" no longer has a part ${entry.span + 1}` };
    return { ok: true, first: span.start, last: span.stop - 1, rev: entry.reverse };
  }

  const find = (label: string) => markers.find((m) => m.label === label)?.index;
  const s = typeof entry.start === "number" ? entry.start : find(entry.start);
  if (s === undefined) return { ok: false, error: `No marker labelled "${entry.start}"` };

  const end = entry.end;
  if (end.type === "length") {
    const n = end.count;
    if (n === 0) return { ok: false, error: "Length must not be 0" };
    return n < 0 ? { ok: true, first: s + n + 1, last: s, rev: true } : { ok: true, first: s, last: s + n - 1, rev: false };
  }
  const e = end.type === "led" ? end.index : find(end.label);
  if (e === undefined) return { ok: false, error: `No marker labelled "${end.type === "marker" ? end.label : ""}"` };
  const extra = end.includeEnd ? 0 : 1;
  if (e === s && extra) return { ok: false, error: "Start and end are the same LED" };
  return e < s ? { ok: true, first: e + extra, last: s, rev: true } : { ok: true, first: s, last: e - extra, rev: false };
}

/** Pairs of plan positions whose segments share LEDs. */
export function overlappingSegments(segments: (ResolvedSegment | undefined)[]): [number, number][] {
  const pairs: [number, number][] = [];
  segments.forEach((a, i) =>
    segments.slice(i + 1).forEach((b, k) => {
      if (a && b && a.start < b.stop && b.start < a.stop) pairs.push([i, i + 1 + k]);
    }),
  );
  return pairs;
}

export interface ApplySegmentsOptions {
  /** Settings for segments the preset doesn't have yet. */
  template: Segment;
  /** Pad with clear markers up to this many segments so loading the preset turns other segments off. */
  clearOthersUpTo?: number;
}

/**
 * Replaces a preset's segment geometry with the planned segments, in plan order. Segment N keeps the
 * effect settings of the preset's Nth segment; segments past the plan are dropped.
 */
export function applySegments(state: PresetState, planned: ResolvedSegment[], opts: ApplySegmentsOptions): PresetState {
  const existing = state.seg.filter((s) => !isClearMarker(s));
  const seg: Segment[] = planned.map(({ name, ...geometry }, i) => {
    const { n: _, ...base } = existing[i] ?? opts.template;
    return { ...base, id: i, ...geometry, ...(name ? { n: name } : {}) };
  });
  for (let id = seg.length; id < (opts.clearOthersUpTo ?? 0); id++) seg.push({ id, stop: 0 });
  // The main segment must exist, or WLED falls back to segment 0 anyway.
  const { mainseg, ...rest } = state;
  return { ...rest, ...(mainseg !== undefined && mainseg < planned.length ? { mainseg } : {}), seg };
}
