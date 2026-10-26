import type { PaletteRef, PresetInput, PresetState, Segment } from "./schemas.js";

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
  return { ...base, kind: "state", state: { ...rest, seg } as PresetState };
}

export interface RenderContext {
  /** Effect names on the target device, indexed by effect ID. */
  effects: string[];
  /** Device palette ID for a library palette, or undefined if it isn't on the target device. */
  devicePalette: (paletteId: string) => number | undefined;
  /** Library palette names, for warnings. */
  paletteName?: (paletteId: string) => string | undefined;
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

/** Renders a library preset as the JSON stored in the target device's presets.json. */
export function renderPreset(preset: PresetInput, ctx: RenderContext): RenderedPreset {
  const warnings: string[] = [];
  const head = { n: preset.name, ...(preset.ql ? { ql: preset.ql } : {}) };
  if (preset.kind === "raw") return { json: { ...preset.raw, ...head }, warnings };

  const seg = preset.state!.seg.map((s) => {
    const { fxName, pal, ...out } = s;
    const rendered: Record<string, unknown> = { ...out };
    if (fxName !== undefined && ctx.effects.length) {
      // Effect IDs can shift between firmware versions; the name is authoritative when present.
      const idx = ctx.effects.indexOf(fxName);
      if (idx >= 0) rendered.fx = idx;
      else warnings.push(`effect "${fxName}" isn't available on this controller`);
    }
    if (pal !== undefined) rendered.pal = resolvePalette(pal, ctx, warnings);
    return rendered;
  });
  return { json: { ...preset.state!, seg, ...head }, warnings };
}

/** Library palette IDs a preset references. */
export function presetPaletteIds(preset: Pick<PresetInput, "kind" | "state">): string[] {
  if (preset.kind !== "state") return [];
  return [
    ...new Set(preset.state!.seg.flatMap((s) => (s.pal !== undefined && typeof s.pal === "object" ? [s.pal.paletteId] : []))),
  ];
}
