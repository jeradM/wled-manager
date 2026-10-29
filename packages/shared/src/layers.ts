import type { Layer, Segment } from "./schemas.js";

/** What makes a segment itself rather than how it looks: its ID, LEDs, direction and name. */
export const PLACEMENT_KEYS = new Set(["id", "start", "stop", "rev", "sid", "n"]);

const look = (o: Record<string, unknown>): Layer => {
  const out: Layer = {};
  for (const [k, v] of Object.entries(o)) if (!PLACEMENT_KEYS.has(k) && k !== "layers") out[k] = v;
  return out;
};

/** A segment's ID, LEDs, direction and name, without any of its looks. */
export function placementOf(s: Segment): Segment {
  const out: Segment = {};
  for (const [k, v] of Object.entries(s)) if (PLACEMENT_KEYS.has(k)) out[k] = v;
  return out;
}

/** Every layer of a segment, bottom to top: its own settings first, then `layers`. */
export function segmentLayers(s: Segment): Layer[] {
  return [look(s), ...(s.layers ?? []).map(look)];
}

/** `s` with `layers` (bottom to top) as its looks: the bottom one on the segment itself, the rest in `layers`. */
export function withLayers(s: Segment, layers: Layer[]): Segment {
  const [bottom = {}, ...rest] = layers;
  return { ...placementOf(s), ...look(bottom), ...(rest.length ? { layers: rest.map(look) } : {}) };
}

/** The layers of a layered effect by its ID, or undefined when there's no such effect. */
export type EffectLookup = (effectId: string) => Layer[] | undefined;

const isMarkerSegment = (s: Segment) => s.stop === 0 && Object.keys(s).every((k) => k === "stop" || k === "id");

/**
 * WLED segments the segments render to: one per layer (a clear marker is one), a link to a layered effect
 * counting as the effect's layers (one if it can't be looked up).
 */
export const wledSegmentCount = (seg: Segment[], lookup?: EffectLookup) =>
  seg.reduce(
    (n, s) =>
      n + (isMarkerSegment(s) ? 1 : segmentLayers(s).reduce((m, l) => m + (l.effectId !== undefined ? (lookup?.(l.effectId)?.length ?? 1) : 1), 0)),
    0,
  );

/** Whether any segment links to a layered effect. */
export const hasEffectLinks = (seg: Segment[]) => seg.some((s) => !isMarkerSegment(s) && segmentLayers(s).some((l) => l.effectId !== undefined));

/** Where a layer of a resolved stack came from: its place in the segment's own stack, and the linked effect's layer if any. */
export interface LayerSource {
  layer: number;
  effectId?: string;
  effectLayer?: number;
}

/** A stack with every link to a layered effect replaced by copies of the effect's layers. */
export function resolveLayerLinks(layers: Layer[], lookup: EffectLookup): { layers: Layer[]; sources: LayerSource[]; missing: string[] } {
  const out: Layer[] = [];
  const sources: LayerSource[] = [];
  const missing: string[] = [];
  layers.forEach((l, k) => {
    if (l.effectId === undefined) {
      out.push(l);
      sources.push({ layer: k });
      return;
    }
    const linked = lookup(l.effectId);
    if (!linked) {
      missing.push(l.effectId);
      return;
    }
    linked.forEach((x, j) => {
      // Effects don't nest: a link inside an effect is dropped.
      const { effectId: _, ...copy } = structuredClone(x);
      out.push(copy);
      sources.push({ layer: k, effectId: l.effectId, effectLayer: j });
    });
  });
  return { layers: out, sources, missing };
}

/**
 * Segments with links to layered effects replaced by the effects' layers. `sources[i]` says where each of
 * segment i's resolved layers came from; `missing` lists links to effects the lookup doesn't know.
 */
export function resolveEffectLinks(seg: Segment[], lookup: EffectLookup): { seg: Segment[]; sources: LayerSource[][]; missing: string[] } {
  const missing: string[] = [];
  const sources: LayerSource[][] = [];
  const out = seg.map((s) => {
    const layers = segmentLayers(s);
    if (isMarkerSegment(s) || !layers.some((l) => l.effectId !== undefined)) {
      sources.push(layers.map((_, k) => ({ layer: k })));
      return s;
    }
    const r = resolveLayerLinks(layers, lookup);
    missing.push(...r.missing);
    sources.push(r.sources);
    return withLayers(s, r.layers);
  });
  return { seg: out, sources, missing };
}

/** Segments with their links to one layered effect turned into copies of its layers (when it's deleted). */
export const inlineEffect = (seg: Segment[], effectId: string, layers: Layer[]): Segment[] =>
  seg.map((s) => {
    const own = segmentLayers(s);
    if (isMarkerSegment(s) || !own.some((l) => l.effectId === effectId)) return s;
    return withLayers(s, own.flatMap((l) => (l.effectId === effectId ? structuredClone(layers) : [l])));
  });

/** Where a WLED segment came from: the preset segment's position and the layer (0 = bottom). */
export interface LayerOrigin {
  segment: number;
  layer: number;
}

/**
 * The segments as WLED sees them: each layer a segment of its own on the parent's LEDs, in order, bottom
 * layer first. IDs are left as they are; `origin` says which segment and layer each one is.
 */
export function expandLayers(seg: Segment[]): { seg: Segment[]; origin: LayerOrigin[] } {
  const out: Segment[] = [];
  const origin: LayerOrigin[] = [];
  seg.forEach((s, i) => {
    if (!s.layers?.length) {
      out.push(s);
      origin.push({ segment: i, layer: 0 });
      return;
    }
    const place = placementOf(s);
    segmentLayers(s).forEach((l, k) => {
      out.push({ ...place, ...l });
      origin.push({ segment: i, layer: k });
    });
  });
  return { seg: out, origin };
}

const isMarker = (s: Segment) => s.stop === 0 && Object.keys(s).every((k) => k === "stop" || k === "id");

/**
 * `after` (an edit of `before`) with as many clear markers dropped from or added to its end as layers were
 * added or removed, so a preset padded to turn other segments off keeps rendering to the same number of WLED
 * segments. Presets without clear markers are left alone.
 */
export function keepPadding(before: Segment[], after: Segment[], lookup?: EffectLookup): Segment[] {
  if (!before.some(isMarker)) return after;
  let diff = wledSegmentCount(after, lookup) - wledSegmentCount(before, lookup);
  const out = [...after];
  while (diff > 0 && out.length && isMarker(out[out.length - 1]!)) {
    out.pop();
    diff--;
  }
  while (diff < 0) {
    out.push({ id: out.length, stop: 0 });
    diff++;
  }
  return out;
}
