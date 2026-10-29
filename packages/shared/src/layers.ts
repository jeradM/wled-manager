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

/** WLED segments the segments render to: one per layer (a clear marker is one). */
export const wledSegmentCount = (seg: Segment[]) => seg.reduce((n, s) => n + 1 + (s.layers?.length ?? 0), 0);

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
export function keepPadding(before: Segment[], after: Segment[]): Segment[] {
  if (!before.some(isMarker)) return after;
  let diff = wledSegmentCount(after) - wledSegmentCount(before);
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
