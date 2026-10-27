import type { LedMarker, PresetState, Segment, SegmentPlanEntry } from "./schemas.js";

/** A plan entry turned into WLED geometry: LEDs start..stop-1, running backwards when rev is set. */
export interface ResolvedSegment {
  name?: string;
  start: number;
  stop: number;
  rev: boolean;
}

export type SegmentResolution = { ok: true; segment: ResolvedSegment } | { ok: false; error: string };

/**
 * WLED saves {"stop": 0} entries for unused segment slots; loading the preset clears those segments.
 * They carry no settings of their own.
 */
export const isClearMarker = (s: Segment) => s.stop === 0 && Object.keys(s).every((k) => k === "stop" || k === "id");

/**
 * Resolves a plan entry against a controller's markers. The segment runs from its start towards its end,
 * so an end before the start gives a reversed segment whose effects still flow from the start.
 */
export function resolveSegment(entry: SegmentPlanEntry, markers: LedMarker[], ledCount: number): SegmentResolution {
  const find = (label: string) => markers.find((m) => m.label === label)?.index;
  const s = typeof entry.start === "number" ? entry.start : find(entry.start);
  if (s === undefined) return { ok: false, error: `No marker labelled "${entry.start}"` };

  let first: number; // lowest LED covered
  let last: number; // highest LED covered
  let rev: boolean;
  if (entry.end.type === "length") {
    const n = entry.end.count;
    if (n === 0) return { ok: false, error: "Length must not be 0" };
    rev = n < 0;
    [first, last] = rev ? [s + n + 1, s] : [s, s + n - 1];
  } else {
    const end = entry.end;
    const e = end.type === "led" ? end.index : find(end.label);
    if (e === undefined) return { ok: false, error: `No marker labelled "${end.type === "marker" ? end.label : ""}"` };
    const extra = entry.end.includeEnd ? 0 : 1;
    if (e === s && extra) return { ok: false, error: "Start and end are the same LED" };
    rev = e < s;
    [first, last] = rev ? [e + extra, s] : [s, e - extra];
  }
  if (first < 0 || last >= ledCount)
    return { ok: false, error: `Runs past the ends of the strip (LEDs 0–${ledCount - 1})` };

  return { ok: true, segment: { ...(entry.name ? { name: entry.name } : {}), start: first, stop: last + 1, rev } };
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
  const seg: Segment[] = planned.map(({ name, start, stop, rev }, i) => {
    const { n: _, ...base } = existing[i] ?? opts.template;
    return { ...base, id: i, start, stop, rev, ...(name ? { n: name } : {}) };
  });
  for (let id = seg.length; id < (opts.clearOthersUpTo ?? 0); id++) seg.push({ id, stop: 0 });
  // The main segment must exist, or WLED falls back to segment 0 anyway.
  const { mainseg, ...rest } = state;
  return { ...rest, ...(mainseg !== undefined && mainseg < planned.length ? { mainseg } : {}), seg };
}
