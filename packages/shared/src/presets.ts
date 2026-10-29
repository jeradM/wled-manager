import { expandLayers, placementOf, segmentLayers } from "./layers.js";
import type { Layer, PaletteRef, PresetInput, PresetState, Segment } from "./schemas.js";
import { isClearMarker, segmentSets, type SegmentRefResolution } from "./segments.js";

export type DevicePreset = Record<string, unknown>;

/** JSON with object keys sorted at every level, for comparing presets regardless of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A device preset is a "state" preset when it is a plain light state: segments as an array of
 * objects, without per-LED data, playlists or API command strings. Everything else is kept raw.
 */
export function isStatePreset(p: DevicePreset): boolean {
  if ("win" in p || "playlist" in p || "pl" in p || "ps" in p) return false;
  if (!Array.isArray(p.seg)) return false;
  return p.seg.every((s) => isObject(s) && !("i" in s));
}

export interface ImportContext {
  /** Effect names on the source device, indexed by effect ID. */
  effects: string[];
  /** Library palette ID for a device palette ID, if that custom palette was imported. */
  libraryPalette: (devicePaletteId: number) => string | undefined;
}

/** Converts a device preset into a library preset. */
export function importPreset(slot: number, p: DevicePreset, ctx: ImportContext): PresetInput {
  const { n, ql, ...rest } = p;
  const name = typeof n === "string" && n.trim() ? n.slice(0, 64) : `Preset ${slot}`;
  const base = { slot, name, ...(typeof ql === "string" && ql ? { ql } : {}) };

  if (!isStatePreset(p)) return { ...base, kind: "raw", raw: rest };

  const seg = (rest.seg as Record<string, unknown>[]).map((s): Segment => {
    const out: Segment = { ...s };
    if (typeof s.fx === "number" && ctx.effects[s.fx] !== undefined) out.fxName = ctx.effects[s.fx];
    if (typeof s.pal === "number") {
      const paletteId = ctx.libraryPalette(s.pal);
      if (paletteId) out.pal = { paletteId };
    }
    return out;
  });
  return { ...base, kind: "state", state: { ...rest, seg: mergeLayers(seg) } as PresetState };
}

/**
 * Device segments stacked on the same LEDs (same start, stop, direction and name) become layers of one
 * segment. Only next-door segments merge, and only when every segment's ID is its position, so rendering
 * the preset gives back the device's segments exactly, in the same blend order.
 */
function mergeLayers(seg: Segment[]): Segment[] {
  if (!seg.every((s, p) => (s.id ?? p) === p)) return seg;
  const where = (s: Segment) => {
    const { id: _, ...place } = placementOf(s);
    return canonicalJson(place);
  };
  const out: Segment[] = [];
  let prev: Segment | undefined;
  for (const s of seg) {
    if (prev && !isClearMarker(prev) && !isClearMarker(s) && where(prev) === where(s)) {
      prev.layers = [...(prev.layers ?? []), segmentLayers(s)[0]!];
      continue;
    }
    prev = { ...s };
    out.push(prev);
  }
  return out;
}

export interface RenderContext {
  /** Effect names on the target device, indexed by effect ID. */
  effects: string[];
  /** Device palette ID for a library palette, or undefined if it isn't on the target device. */
  devicePalette: (paletteId: string) => number | undefined;
  /** Library palette names, for warnings. */
  paletteName?: (paletteId: string) => string | undefined;
  /**
   * Geometry of a defined segment on the target device. Segments whose definition isn't there are left out.
   * Without it, saved start/stop values are used.
   */
  segment?: (sid: string) => SegmentRefResolution;
}

export interface RenderedPreset {
  json: DevicePreset;
  warnings: string[];
}

const resolvePalette = (pal: PaletteRef, ctx: RenderContext, warnings: string[]): number => {
  if (typeof pal === "number") return pal;
  const id = ctx.devicePalette(pal.paletteId);
  if (id !== undefined) return id;
  warnings.push(`palette "${ctx.paletteName?.(pal.paletteId) ?? pal.paletteId}" isn't on this controller; using Default`);
  return 0;
};

const MAX_WLED_SEGMENTS = 32;

/** Renders a library preset as the JSON stored in the target device's presets.json. */
export function renderPreset(preset: PresetInput, ctx: RenderContext): RenderedPreset {
  const warnings: string[] = [];
  const head = { n: preset.name, ...(preset.ql ? { ql: preset.ql } : {}) };
  if (preset.kind === "raw") return { json: { ...preset.raw, ...head }, warnings };

  const segs = preset.state!.seg;
  const ids = segs.map((s, i) => s.id ?? i);
  const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (repeated.length)
    warnings.push(`segment ID${repeated.length > 1 ? "s" : ""} ${repeated.join(", ")} used more than once; only the last of each is applied`);
  const placed = segs.map((s) => (s.sid !== undefined && ctx.segment ? ctx.segment(s.sid) : undefined));
  // Layers become WLED segments of their own on the same LEDs, numbered in order.
  const layered = segs.some((s) => s.layers?.length);
  const expanded = expandLayers(segs);
  const explicitIds = segs.some((s) => s.id !== undefined) || placed.some((r) => r && !r.ok);
  // Left-out segments mustn't renumber the others, so IDs become explicit. A preset that turns other segments
  // off turns the left-out ones off too.
  const leftOut = placed.some((r) => r && !r.ok);
  const clearsOthers = segs.some(isClearMarker);
  // Groups become WLED segment sets; presets without groups keep whatever sets they have.
  const sets = segmentSets(segs, preset.groups);
  /** Which expanded segment each rendered one is. */
  const entryOf = new Map<Record<string, unknown>, number>();
  const seg = expanded.seg.flatMap((s, e): Record<string, unknown>[] => {
    const { segment: i, layer } = expanded.origin[e]!;
    const { fxName, pal, sid, layers: _, ...out } = s;
    // With layers, WLED IDs follow the layers' order; they're written out if the preset has any or some go missing.
    const id = layered ? e : (s.id ?? i);
    const rendered: Record<string, unknown> = leftOut ? { id, ...out } : { ...out };
    if (layered) {
      if (explicitIds) rendered.id = e;
      else delete rendered.id;
    }
    const r = placed[i];
    const which = segs[i]!.layers?.length ? `segment ${segs[i]!.id ?? i}, layer ${layer + 1}: ` : "";
    if (r && !r.ok) {
      if (layer === 0) warnings.push(`segment ${segs[i]!.id ?? i} left out: ${r.error}`);
      return clearsOthers ? [{ id, stop: 0 }] : [];
    }
    if (r?.ok) {
      const { start, stop, rev, name } = r.segment;
      Object.assign(rendered, { start, stop, rev });
      if (name) rendered.n = name;
      else delete rendered.n;
    }
    if (fxName !== undefined && ctx.effects.length) {
      // Effect IDs can shift between firmware versions; the name is authoritative when present.
      const idx = ctx.effects.indexOf(fxName);
      if (idx >= 0) rendered.fx = idx;
      else warnings.push(`${which}effect "${fxName}" isn't available on this controller`);
    }
    if (pal !== undefined) rendered.pal = resolvePalette(pal, ctx, warnings);
    if (sets?.[i] !== undefined) rendered.set = sets[i];
    entryOf.set(rendered, e);
    return [rendered];
  });
  const state: Record<string, unknown> = { ...preset.state! };
  if (layered) {
    // IDs stay in layer order (left-out segments don't renumber the rest). Past WLED's 32 segments, the last
    // clear markers go. The main segment is its bottom layer.
    for (let j = seg.length - 1; j >= 0 && seg.length > MAX_WLED_SEGMENTS; j--) if (isClearMarker(seg[j] as Segment)) seg.splice(j, 1);
    const mainAt = segs.findIndex((s, p) => !isClearMarker(s) && (s.id ?? p) === preset.state!.mainseg);
    const mainEntry = expanded.origin.findIndex((o) => o.segment === mainAt);
    const main = mainAt >= 0 ? seg.find((s) => entryOf.get(s) === mainEntry) : undefined;
    if (main) state.mainseg = (main.id as number | undefined) ?? seg.indexOf(main);
    else delete state.mainseg;
  }
  return { json: { ...state, seg, ...head }, warnings };
}

/** Library palette IDs a preset references. */
export function presetPaletteIds(preset: Pick<PresetInput, "kind" | "state">): string[] {
  if (preset.kind !== "state") return [];
  return [
    ...new Set(
      preset.state!.seg.flatMap((s) => segmentLayers(s).flatMap((l: Layer) => (l.pal !== undefined && typeof l.pal === "object" ? [l.pal.paletteId] : []))),
    ),
  ];
}
