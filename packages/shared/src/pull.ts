import { segmentLayers, withLayers } from "./layers.js";
import { canonicalJson, stripGroupPrefix, type DevicePreset, type RenderedPreset } from "./presets.js";
import type { Layer, PresetInput, Segment } from "./schemas.js";

/** Settings of a WLED segment that belong to a layer, with names for summaries. */
const LOOK_FIELDS: Record<string, string> = {
  on: "power",
  bri: "brightness",
  fx: "effect",
  sx: "speed",
  ix: "intensity",
  c1: "custom 1",
  c2: "custom 2",
  c3: "custom 3",
  o1: "option 1",
  o2: "option 2",
  o3: "option 3",
  col: "colors",
  pal: "palette",
  bm: "blend mode",
  grp: "grouping",
  spc: "spacing",
  of: "offset",
  mi: "mirror",
  cct: "white balance",
  si: "sound",
  m12: "1D mapping",
};
/** Settings that place a segment, shared by its layers. */
const PLACEMENT_FIELDS: Record<string, string> = { start: "LEDs", stop: "LEDs", rev: "direction", n: "name" };
const TOP_FIELDS: Record<string, string> = { on: "power", bri: "brightness", transition: "transition" };

export interface PullContext {
  /** Effect names on the controller, indexed by effect ID. */
  effects: string[];
  /** The library palette a device palette ID is, when it's one of the custom palettes sync put there. */
  libraryPalette: (devicePaletteId: number) => string | undefined;
  /** A pattern's name, when the layered effect `effectId` is a pattern. */
  patternName?: (effectId: string) => string | undefined;
  /** Prefixes sync puts on preset names, by group; taken back off names pulled. */
  groupPrefixes?: Record<string, string>;
}

export interface PulledPreset {
  preset: PresetInput;
  /** What changed on the controller, e.g. "brightness" or "Roof: effect, speed". */
  changes: string[];
  /** Changes left out, and links undone. */
  notes: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const segId = (s: Record<string, unknown>, i: number) => (typeof s.id === "number" ? s.id : i);
const isMarker = (s: Record<string, unknown>) => s.stop === 0;

/** Whether a controller's value matches what was sent; colors only compare the ones that were sent. */
function same(field: string, sent: unknown, device: unknown): boolean {
  if (field === "n") return (sent ?? "") === (device ?? "");
  if (field === "col" && Array.isArray(sent) && Array.isArray(device))
    return sent.every((c, j) => canonicalJson(c) === canonicalJson(device[j]));
  return canonicalJson(sent) === canonicalJson(device);
}

/**
 * A state preset with what was changed on a controller (its copy `device`, against `rendered`, what sync would
 * write there) brought back into the library's version. Only settings that differ are taken, so what the
 * controller can't show stays: links to defined segments, stop LEDs past this controller's end, segments other
 * controllers have, groups. A segment linked to a layered effect is unlinked only when its looks changed.
 * Null when the controller's copy has different segments: then it can only replace the library's version.
 */
export function pullPreset(library: PresetInput, rendered: RenderedPreset, device: DevicePreset, ctx: PullContext): PulledPreset | null {
  if (library.kind !== "state" || !rendered.origin || !rendered.seg || !Array.isArray(device.seg)) return null;
  const sent = rendered.json.seg as Record<string, unknown>[];
  const onDevice = (device.seg as unknown[]).filter(isObject);
  const deviceById = new Map(onDevice.map((d, j) => [segId(d, j), d]));
  const sentIds = sent.flatMap((s, j) => (rendered.origin![j] ? [segId(s, j)] : []));
  const deviceIds = onDevice.flatMap((d, j) => (isMarker(d) ? [] : [segId(d, j)]));
  if (canonicalJson([...sentIds].sort()) !== canonicalJson([...deviceIds].sort())) return null;

  const seg: Segment[] = structuredClone(library.state!.seg);
  const resolved = rendered.seg;
  const changed = new Map<string, Set<string>>();
  const notes = new Set<string>();
  // Names as the controller shows them: a defined segment's comes from its definition.
  const shownName = (i: number) => sent.find((_, j) => rendered.origin![j]?.segment === i)?.n;
  const label = (i: number, k: number) => {
    const s = resolved[i]!;
    const n = shownName(i);
    const name = typeof n === "string" && n ? n : `Segment ${s.id ?? i}`;
    return segmentLayers(s).length > 1 ? `${name} layer ${k + 1}` : name;
  };
  const note = (where: string, what: string) => changed.set(where, (changed.get(where) ?? new Set()).add(what));
  const linked = (i: number) => segmentLayers(seg[i]!).some((l) => l.effectId !== undefined);

  sent.forEach((r, j) => {
    const origin = rendered.origin![j];
    if (!origin) return;
    const { segment: i, layer: k } = origin;
    const d = deviceById.get(segId(r, j))!;

    // A pattern's segments are made from the pattern, so it's changed in the app instead.
    const pattern = segmentLayers(seg[i]!).flatMap((l) => (l.effectId !== undefined ? [ctx.patternName?.(l.effectId)] : [])).find(Boolean);
    if (pattern) {
      const fields = [...Object.keys(LOOK_FIELDS), ...Object.keys(PLACEMENT_FIELDS)];
      if (fields.some((f) => d[f] !== undefined && !same(f, r[f], d[f])))
        notes.add(`${label(i, 0).replace(/ layer \d+$/, "")}: uses the pattern "${pattern}", so its changes aren't pulled; edit the pattern instead`);
      return;
    }

    // The looks of this layer.
    const looks: [string, unknown][] = [];
    for (const f of Object.keys(LOOK_FIELDS)) {
      if (d[f] === undefined || same(f, r[f], d[f])) continue;
      // Settings the library left to the controller are filled in quietly, but don't undo a link for them.
      if (r[f] === undefined && linked(i)) continue;
      looks.push([f, d[f]]);
      if (r[f] !== undefined) note(label(i, k), LOOK_FIELDS[f]!);
    }
    if (looks.length) {
      if (linked(i)) {
        seg[i] = structuredClone(resolved[i]!);
        notes.add(`${label(i, 0).replace(/ layer \d+$/, "")}: unlinked from its layered effect, which the controller changed`);
      }
      const layers = segmentLayers(seg[i]!);
      const layer: Layer = { ...layers[k] };
      for (const [f, v] of looks) {
        if (f === "fx") {
          layer.fx = v as number;
          if (typeof v === "number" && ctx.effects[v] !== undefined) layer.fxName = ctx.effects[v];
          else delete layer.fxName;
        } else if (f === "pal" && typeof v === "number") {
          const paletteId = ctx.libraryPalette(v);
          layer.pal = paletteId ? { paletteId } : v;
        } else layer[f] = v;
      }
      layers[k] = layer;
      seg[i] = withLayers(seg[i]!, layers);
    }

    // Where the segment is, once per segment.
    if (k !== 0) return;
    for (const f of Object.keys(PLACEMENT_FIELDS)) {
      if (d[f] === undefined || same(f, r[f], d[f])) continue;
      if (seg[i]!.sid) {
        notes.add(`${label(i, 0)}: its ${PLACEMENT_FIELDS[f]} come from a defined segment, so changes to them aren't pulled`);
        continue;
      }
      seg[i] = { ...seg[i]!, [f]: d[f] };
      if (r[f] !== undefined) note(label(i, 0), PLACEMENT_FIELDS[f]!);
    }
  });

  const state = { ...library.state!, seg };
  const top: string[] = [];
  for (const f of Object.keys(TOP_FIELDS)) {
    const v = device[f];
    if (v === undefined || same(f, rendered.json[f], v)) continue;
    (state as Record<string, unknown>)[f] = v;
    if (rendered.json[f] !== undefined) top.push(TOP_FIELDS[f]!);
  }
  const head: Partial<PresetInput> = {};
  if (typeof device.n === "string" && device.n.trim() && device.n !== rendered.json.n) {
    const name = library.folder ? stripGroupPrefix(device.n, ctx.groupPrefixes, library.folder).name : device.n;
    if (name !== library.name) {
      head.name = name.slice(0, 64);
      top.unshift("name");
    }
  }
  const ql = typeof device.ql === "string" && device.ql ? device.ql : undefined;
  if (ql !== library.ql) {
    head.ql = ql;
    top.push("quick-load label");
  }

  const changes = [...(top.length ? [top.join(", ")] : []), ...[...changed].map(([where, what]) => `${where}: ${[...what].join(", ")}`)];
  return { preset: { ...library, ...head, state }, changes, notes: [...notes] };
}
