import { expandLayers, hasEffectLinks, placementOf, resolveEffectLinks, segmentLayers, type EffectLookup, type LayerOrigin } from "./layers.js";
import type { Layer, PaletteRef, PresetInput, PresetState, Segment, SegmentGroup } from "./schemas.js";
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
  const merged = mergeLayers(seg);
  const groups = setGroups(merged);
  return { ...base, kind: "state", state: { ...rest, seg: merged } as PresetState, ...(groups.length ? { groups } : {}) };
}

/**
 * Segments the controller put in segment sets 1–3 become groups, one per set, keeping the set number so
 * the preset renders back unchanged. Segments in set 0 (the default) stay ungrouped.
 */
function setGroups(seg: Segment[]): SegmentGroup[] {
  const bySet = new Map<number, number[]>();
  seg.forEach((s, p) => {
    if (isClearMarker(s) || typeof s.set !== "number" || s.set < 1 || s.set > 3) return;
    bySet.set(s.set, [...(bySet.get(s.set) ?? []), p]);
  });
  return [...bySet.entries()].sort(([a], [b]) => a - b).map(([set, members]) => ({ name: `Set ${set}`, members, set }));
}

/**
 * Device segments stacked on the same LEDs (same start, stop, direction and name) become layers of one
 * segment. Only next-door segments merge, and only when every segment's ID is its position, so rendering
 * the preset gives back the device's segments exactly, in the same blend order.
 */
function mergeLayers(seg: Segment[]): Segment[] {
  if (!seg.every((s, p) => (s.id ?? p) === p)) return seg;
  // Layers share their segment's LEDs, name and segment set.
  const where = (s: Segment) => {
    const { id: _, ...place } = placementOf(s);
    return canonicalJson({ ...place, set: s.set });
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
  /**
   * LEDs on the target device. Segments set to run past the end stop at it, as WLED would stop them anyway,
   * so the stored preset matches what the controller shows; ones starting past it get a warning.
   */
  ledCount?: number;
  /**
   * The device slot of the library preset in `slot`, when sync numbers presets itself (undefined: the preset
   * isn't on this controller). Playlists and preset commands are pointed at the new slots. Without it, slots
   * are used as they are.
   */
  presetSlot?: (slot: number) => number | undefined;
  /** Prefixes for preset names, by group. */
  groupPrefixes?: Record<string, string>;
  /** Layers of the library's layered effects, for layers linked to one. */
  effect?: EffectLookup;
  /** Layered effect names, for warnings. */
  effectName?: (effectId: string) => string | undefined;
}

export interface RenderedPreset {
  json: DevicePreset;
  warnings: string[];
  /**
   * For state presets, where each WLED segment in `json.seg` came from: a segment of `seg` and its layer (0 =
   * the bottom), or null for a clear marker.
   */
  origin?: (LayerOrigin | null)[];
  /** The preset's segments with links to layered effects replaced by the effects' layers, as rendered. */
  seg?: Segment[];
}

const resolvePalette = (pal: PaletteRef, ctx: RenderContext, warnings: string[]): number => {
  if (typeof pal === "number") return pal;
  const id = ctx.devicePalette(pal.paletteId);
  if (id !== undefined) return id;
  warnings.push(`palette "${ctx.paletteName?.(pal.paletteId) ?? pal.paletteId}" isn't on this controller; using Default`);
  return 0;
};

const MAX_WLED_SEGMENTS = 32;

/** Per-entry playlist settings, which follow the playlist's presets when some are left out. */
const PLAYLIST_LISTS = ["ps", "dur", "transition"] as const;

/**
 * A raw preset with the presets it applies (a playlist's, its end preset, a "ps" command) moved to the slots
 * `slotOf` gives; ones it gives none for are left out, with a warning.
 */
export function remapPresetRefs(raw: Record<string, unknown>, slotOf: (slot: number) => number | undefined, warnings: string[] = []): Record<string, unknown> {
  const missing = new Set<number>();
  const map = (v: unknown) => {
    if (typeof v !== "number" || v < 1 || v > 250) return v; // 0 and 251+ are commands, not slots
    const to = slotOf(v);
    if (to === undefined) missing.add(v);
    return to;
  };
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.ps === "number") {
    const to = map(out.ps);
    if (to === undefined) delete out.ps;
    else out.ps = to;
  }
  const pl = raw.playlist;
  if (pl && typeof pl === "object" && !Array.isArray(pl)) {
    const list = { ...(pl as Record<string, unknown>) };
    if (Array.isArray(list.ps)) {
      const keep = list.ps.map((v) => map(v) !== undefined);
      const mapped = list.ps.map(map);
      for (const k of PLAYLIST_LISTS)
        if (Array.isArray(list[k])) list[k] = (k === "ps" ? mapped : (list[k] as unknown[])).filter((_, j) => keep[j] ?? true);
    }
    if (list.end !== undefined) {
      const to = map(list.end);
      if (to === undefined) delete list.end;
      else list.end = to;
    }
    out.playlist = list;
  }
  if (missing.size)
    warnings.push(`preset${missing.size > 1 ? "s" : ""} in slot${missing.size > 1 ? "s" : ""} ${[...missing].join(", ")} ${missing.size > 1 ? "aren't" : "isn't"} on this controller; left out`);
  return out;
}

/**
 * Device slots for presets numbered in order (1, 2, 3…): by group name, presets in no group last, then by name.
 * Keyed by preset ID.
 */
export function orderedPresetSlots(presets: { id: string; name: string; slot: number; folder?: string }[]): Map<string, number> {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const sorted = [...presets].sort(
    (a, b) =>
      (a.folder ? 0 : 1) - (b.folder ? 0 : 1) ||
      cmp(a.folder ?? "", b.folder ?? "") ||
      cmp(a.name, b.name) ||
      a.slot - b.slot,
  );
  return new Map(sorted.map((p, i) => [p.id, i + 1]));
}

/** A preset's name on controllers: its group's prefix, when the group has one, then its name. */
export function deviceName(preset: { name: string; folder?: string }, prefixes?: Record<string, string>): string {
  const prefix = preset.folder ? prefixes?.[preset.folder] : undefined;
  return prefix ? `${prefix} ${preset.name}` : preset.name;
}

/**
 * A name from a controller without the group prefix sync put on it, and the group whose prefix it was. With
 * `folder`, only that group's prefix is taken off.
 */
export function stripGroupPrefix(name: string, prefixes: Record<string, string> = {}, folder?: string): { name: string; folder?: string } {
  const groups = Object.entries(prefixes)
    .filter(([f]) => folder === undefined || f === folder)
    .sort(([, a], [, b]) => b.length - a.length);
  for (const [f, prefix] of groups) {
    const rest = name.startsWith(`${prefix} `) ? name.slice(prefix.length + 1).trim() : "";
    if (rest) return { name: rest, folder: f };
  }
  return { name };
}

/** Renders a library preset as the JSON stored in the target device's presets.json. */
export function renderPreset(preset: PresetInput, ctx: RenderContext): RenderedPreset {
  const warnings: string[] = [];
  const head = { n: deviceName(preset, ctx.groupPrefixes), ...(preset.ql ? { ql: preset.ql } : {}) };
  if (preset.kind === "raw")
    return { json: { ...(ctx.presetSlot ? remapPresetRefs(preset.raw!, ctx.presetSlot, warnings) : preset.raw), ...head }, warnings };

  let segs = preset.state!.seg;
  // Links to layered effects become the effects' current layers.
  if (hasEffectLinks(segs)) {
    const resolved = resolveEffectLinks(segs, ctx.effect ?? (() => undefined));
    segs = resolved.seg;
    for (const id of new Set(resolved.missing))
      warnings.push(`layered effect "${ctx.effectName?.(id) ?? id}" no longer exists; its layers are left out`);
  }
  const ids = segs.map((s, i) => s.id ?? i);
  const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (repeated.length)
    warnings.push(`segment ID${repeated.length > 1 ? "s" : ""} ${repeated.join(", ")} used more than once; only the last of each is applied`);
  const placed = segs.map((s) => (s.sid !== undefined && ctx.segment ? ctx.segment(s.sid) : undefined));
  // Each segment's LEDs on this controller: a defined segment's from its definition, others' stops clamped to
  // the end of the strip. Layers are laid out on them, so patterns repeat from where the segment starts here.
  const sized = segs.map((s, i): Segment => {
    const r = placed[i];
    if (r?.ok) {
      const { start, stop, rev, name } = r.segment;
      const { n: _, ...rest } = s;
      return { ...rest, start, stop, rev, ...(name ? { n: name } : {}) };
    }
    const n = ctx.ledCount;
    if (r || n === undefined || isClearMarker(s) || typeof s.stop !== "number" || s.stop <= n) return s;
    return typeof s.start === "number" && s.start >= n ? s : { ...s, stop: n };
  });
  // Layers become WLED segments of their own on the same LEDs, numbered in order.
  const layered = segs.some((s) => s.layers?.length);
  const expanded = expandLayers(sized);
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
    const start = segs[i]!.start;
    if (!r && ctx.ledCount !== undefined && layer === 0 && typeof start === "number" && start >= ctx.ledCount)
      warnings.push(`segment ${segs[i]!.id ?? i} starts at LED ${start}, past this controller's ${ctx.ledCount} LEDs; it won't show`);
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
  const origin = seg.map((s) => (entryOf.has(s) ? expanded.origin[entryOf.get(s)!]! : null));
  return { json: { ...state, seg, ...head }, warnings, origin, seg: segs };
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
