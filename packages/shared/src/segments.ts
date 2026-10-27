import type { LedMarker, LedRange, LedSpan, PresetInput, PresetState, Segment, SegmentDefinition, SegmentGroup } from "./schemas.js";

/** A segment definition turned into WLED geometry: LEDs start..stop-1, running backwards when rev is set. */
export interface ResolvedSegment {
  name?: string;
  start: number;
  stop: number;
  rev: boolean;
}

export type SegmentResolution = { ok: true; segment: ResolvedSegment } | { ok: false; error: string };

/** What segment definitions are resolved against: a controller's labelled LEDs and its LED count. */
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

export const isRangeEntry = (e: SegmentDefinition): e is Extract<SegmentDefinition, { range: string }> => "range" in e;

/** How a segment definition is shown: its name, or its position on the controller's list. */
export const definitionLabel = (def: SegmentDefinition, position: number) => def.name || `Segment ${position + 1}`;

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

type Layout = { start: number; stop: number; grp: number; spc: number };

/** LEDs a segment actually lights: grouping and spacing repeat from its start. */
export function litLeds(s: Layout): number[] {
  const period = s.grp + s.spc;
  const out: number[] = [];
  for (let p = 0; p < s.stop - s.start; p++) if (p % period < s.grp) out.push(s.start + p);
  return out;
}

/** Pixels an effect sees on the segment: one per group (WLED's virtual length). */
export const virtualLength = (s: Layout) =>
  Math.ceil((s.stop - s.start) / (s.grp + s.spc));

/**
 * Resolves a segment definition against a controller's markers and ranges. A start/end segment runs from its
 * start towards its end, so an end before the start gives a reversed segment whose effects still flow
 * from the start.
 */
export function resolveSegment(entry: SegmentDefinition, ctx: SegmentContext): SegmentResolution {
  const geometry = resolveGeometry(entry, ctx);
  if (!geometry.ok) return geometry;
  const { first, last, rev } = geometry;
  if (first < 0 || last >= ctx.ledCount)
    return { ok: false, error: `Runs past the ends of the strip (LEDs 0–${ctx.ledCount - 1})` };
  return {
    ok: true,
    segment: { ...(entry.name ? { name: entry.name } : {}), start: first, stop: last + 1, rev },
  };
}

type Geometry = { ok: true; first: number; last: number; rev: boolean } | { ok: false; error: string };

function resolveGeometry(entry: SegmentDefinition, { markers, ranges }: SegmentContext): Geometry {
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

/** Pairs of positions whose segments share LEDs. */
export function overlappingSegments(segments: ({ start: number; stop: number } | undefined)[]): [number, number][] {
  const pairs: [number, number][] = [];
  segments.forEach((a, i) =>
    segments.slice(i + 1).forEach((b, k) => {
      if (a && b && a.start < b.stop && b.start < a.stop) pairs.push([i, i + 1 + k]);
    }),
  );
  return pairs;
}

/** A controller as far as segment definitions are concerned. */
export interface SegmentSource {
  id: string;
  segments: SegmentDefinition[];
  markers: LedMarker[];
  ranges: LedRange[];
  /** Null until the controller has been reached; the strip's length is then unknown. */
  device: { ledCount: number } | null;
}

export type SegmentRefResolution =
  | {
      ok: true;
      segment: ResolvedSegment;
      definition: SegmentDefinition;
      /** The definition belongs to another controller; this controller's segment of the same name is used. */
      byName: boolean;
    }
  | { ok: false; error: string };

/**
 * Finds the geometry a preset segment's definition has on `target`. Definitions are per controller, so on
 * a controller that doesn't have the definition itself, its segment with the same name stands in.
 */
export function resolveSegmentRef(sid: string, target: SegmentSource, all: SegmentSource[]): SegmentRefResolution {
  let definition = target.segments.find((d) => d.id === sid);
  let byName = false;
  if (!definition) {
    const origin = all.flatMap((c) => c.segments).find((d) => d.id === sid);
    if (!origin) return { ok: false, error: "its defined segment was deleted" };
    if (!origin.name) return { ok: false, error: "it uses an unnamed segment defined on another controller" };
    const name = origin.name.toLowerCase();
    definition = target.segments.find((d) => d.name?.toLowerCase() === name);
    if (!definition) return { ok: false, error: `this controller has no segment named "${origin.name}"` };
    byName = true;
  }
  const resolved = resolveSegment(definition, {
    markers: target.markers,
    ranges: target.ranges,
    ledCount: target.device?.ledCount ?? 65535,
  });
  if (!resolved.ok) return { ok: false, error: `${definitionLabel(definition, target.segments.indexOf(definition))}: ${resolved.error}` };
  return { ok: true, segment: resolved.segment, definition, byName };
}

/** Why a preset doesn't sync to a controller, or undefined if it does. */
export function presetSkipReason(
  preset: Pick<PresetInput, "kind" | "state" | "controllers">,
  target: SegmentSource,
  all: SegmentSource[],
): string | undefined {
  if (preset.controllers && !preset.controllers.includes(target.id)) return "not chosen for this controller";
  if (preset.kind !== "state") return undefined;
  const sids = preset.state!.seg.flatMap((s) => (s.sid && !isClearMarker(s) ? [s.sid] : []));
  if (sids.length && !sids.some((sid) => resolveSegmentRef(sid, target, all).ok))
    return "none of its segments are defined on this controller";
  return undefined;
}

/** A preset segment using a defined segment: the definition's LEDs, direction and name. */
export function linkSegment(seg: Segment, sid: string, r: ResolvedSegment): Segment {
  const { n: _, ...rest } = seg;
  return { ...rest, sid, start: r.start, stop: r.stop, rev: r.rev, ...(r.name ? { n: r.name } : {}) };
}

/**
 * Puts the preset's segments in `order` (array positions of real segments), renumbering IDs to match, then
 * pads with clear markers up to `padTo` segments. The main segment and group memberships follow their segments.
 */
function reorder(
  state: PresetState,
  groups: SegmentGroup[],
  order: number[],
  padTo: number,
): { state: PresetState; groups: SegmentGroup[] } {
  const real = state.seg.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const newPos = new Map(order.map((p, k) => [p, k]));
  const seg: Segment[] = order.map((p, k) => ({ ...state.seg[p]!, id: k }));
  for (let id = seg.length; id < padTo; id++) seg.push({ id, stop: 0 });
  const { mainseg, ...rest } = state;
  // Only a real segment can be the main one, even if a clear marker's position matches its ID.
  const mainAt = mainseg === undefined ? -1 : (real.find((p) => (state.seg[p]!.id ?? p) === mainseg) ?? -1);
  return {
    state: { ...rest, ...(mainAt >= 0 ? { mainseg: newPos.get(mainAt)! } : {}), seg },
    groups: groups.map((g) => ({ ...g, members: g.members.flatMap((m) => (newPos.has(m) ? [newPos.get(m)!] : [])).sort((a, b) => a - b) })),
  };
}

/**
 * Turns "loading this preset turns the controller's other segments off" on (padding with clear markers up
 * to `maxSegments`) or off (no clear markers). Real segments move to the front, in order.
 */
export function setClearOthers(state: PresetState, groups: SegmentGroup[], on: boolean, maxSegments: number) {
  const real = state.seg.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  return reorder(state, groups, real, on ? maxSegments : 0);
}

/**
 * Moves the segment at array position `from` to where the segment at `to` is, among the preset's real
 * segments. Segment IDs are renumbered to the new order (clear markers go last), and the main segment
 * and group memberships follow their segments.
 */
export function moveSegment(
  state: PresetState,
  groups: SegmentGroup[],
  from: number,
  to: number,
): { state: PresetState; groups: SegmentGroup[] } {
  const real = state.seg.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const order = real.filter((p) => p !== from);
  order.splice(real.indexOf(to), 0, from);
  return reorder(state, groups, order, state.seg.length);
}

/**
 * Gives every segment its array position as ID. WLED applies preset segments by ID, so two segments sharing
 * one would overwrite each other. The main segment follows its segment.
 */
export function renumberSegments(state: PresetState): PresetState {
  const { mainseg, ...rest } = state;
  const mainAt = mainseg === undefined ? -1 : state.seg.findIndex((s, p) => !isClearMarker(s) && (s.id ?? p) === mainseg);
  return { ...rest, ...(mainAt >= 0 ? { mainseg: mainAt } : {}), seg: state.seg.map((s, id) => ({ ...s, id })) };
}

/** WLED has four segment sets, 0–3 (shown as ➊–➍); 0 is where every segment starts. */
export const WLED_SET_COUNT = 4;

/**
 * The WLED segment set each group goes in. Ungrouped segments stay in set 0, so groups take sets 1–3 unless
 * every segment is grouped, in which case they take 0–3. Groups past the last set share it.
 */
export function groupSets(seg: Segment[], groups: SegmentGroup[]): number[] {
  const real = seg.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const allGrouped = real.length > 0 && real.every((p) => groups.some((g) => g.members.includes(p)));
  const first = allGrouped ? 0 : 1;
  return groups.map((_, k) => Math.min(first + k, WLED_SET_COUNT - 1));
}

/** The WLED set of each preset segment (undefined for clear markers), or undefined if the preset has no groups. */
export function segmentSets(seg: Segment[], groups: SegmentGroup[] | undefined): (number | undefined)[] | undefined {
  if (!groups?.length) return undefined;
  const sets = groupSets(seg, groups);
  return seg.map((s, p) => {
    if (isClearMarker(s)) return undefined;
    const k = groups.findIndex((g) => g.members.includes(p));
    return k === -1 ? 0 : sets[k];
  });
}

/** Group memberships after the segment at `position` is removed; `shift` when later segments move up. */
export function removeGroupMember(groups: SegmentGroup[], position: number, shift: boolean): SegmentGroup[] {
  return groups.map((g) => ({
    ...g,
    members: g.members.filter((m) => m !== position).map((m) => (shift && m > position ? m - 1 : m)),
  }));
}

/**
 * Applies what changed between `before` and `after` (one segment edited in a group editor) to every
 * member. Fields the edit removed are removed from the members too; everything else is left alone.
 */
export function applyGroupEdit(seg: Segment[], members: number[], before: Segment, after: Segment): Segment[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return seg.map((s, p) => {
    if (!members.includes(p)) return s;
    const next: Segment = { ...s };
    for (const k of changed) {
      if (after[k] === undefined) delete next[k];
      else next[k] = structuredClone(after[k]);
    }
    return next;
  });
}
