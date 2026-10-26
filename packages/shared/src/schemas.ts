import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "expected #rrggbb");
const byte = z.number().int().min(0).max(255);

// ---- Palettes ----

export const paletteStop = z.object({ pos: byte, color: hexColor });
export type PaletteStop = z.infer<typeof paletteStop>;

export const paletteInput = z.object({
  name: z.string().min(1).max(64),
  stops: z.array(paletteStop).min(2).max(16),
});
export type PaletteInput = z.infer<typeof paletteInput>;

export const palette = paletteInput.extend({
  id: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type Palette = z.infer<typeof palette>;

// ---- Presets ----

/** WLED color: [r, g, b] or [r, g, b, w]. WLED also accepts "rrggbb" hex strings. */
export const wledColor = z.union([
  z.tuple([byte, byte, byte]),
  z.tuple([byte, byte, byte, byte]),
  z.string(),
]);
export type WledColor = z.infer<typeof wledColor>;

/**
 * A segment's palette: a WLED palette ID (built-in, or a device custom palette the library doesn't
 * know about), or a library palette resolved to the right device ID at sync time.
 */
export const paletteRef = z.union([z.number().int().min(0).max(255), z.object({ paletteId: z.string() })]);
export type PaletteRef = z.infer<typeof paletteRef>;

/**
 * A preset segment. Only the fields the editor understands are typed; everything else WLED stores
 * (grp, spc, of, rev, mi, cct, n, ...) is kept as-is. All fields are optional, as in WLED itself.
 */
export const segment = z.looseObject({
  id: z.number().int().optional(),
  start: z.number().int().min(0).optional(),
  stop: z.number().int().min(0).optional(),
  on: z.boolean().optional(),
  bri: byte.optional(),
  fx: z.number().int().min(0).optional(),
  /** Effect name when the preset was saved, used to match effects across firmware versions. */
  fxName: z.string().optional(),
  sx: byte.optional(),
  ix: byte.optional(),
  c1: byte.optional(),
  c2: byte.optional(),
  c3: byte.optional(),
  o1: z.boolean().optional(),
  o2: z.boolean().optional(),
  o3: z.boolean().optional(),
  col: z.array(wledColor).max(3).optional(),
  pal: paletteRef.optional(),
});
export type Segment = z.infer<typeof segment>;

export const presetState = z.looseObject({
  on: z.boolean().optional(),
  bri: byte.optional(),
  transition: z.number().int().min(0).max(65535).optional(),
  mainseg: z.number().int().optional(),
  seg: z.array(segment).max(32),
});
export type PresetState = z.infer<typeof presetState>;

/**
 * "state" presets are structured light states the editor can work with. "raw" presets hold any other
 * WLED preset verbatim: API-command presets ("win"), per-LED presets (seg.i), playlists, etc.
 */
export const presetKind = z.enum(["state", "raw"]);
export type PresetKind = z.infer<typeof presetKind>;

const presetFields = {
  slot: z.number().int().min(1).max(250),
  name: z.string().min(1).max(64),
  /** Quick-load label shown on WLED's preset buttons. */
  ql: z.string().max(8).optional(),
  kind: presetKind,
  state: presetState.optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
};

const hasPayload = (p: { kind: PresetKind; state?: unknown; raw?: unknown }) =>
  p.kind === "state" ? p.state !== undefined : p.raw !== undefined;

export const presetInput = z
  .object(presetFields)
  .refine(hasPayload, { message: "state presets need `state`, raw presets need `raw`" });
export type PresetInput = z.infer<typeof presetInput>;

export const preset = z.object({
  ...presetFields,
  id: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type Preset = z.infer<typeof preset>;

// ---- Controllers ----

export const controllerInput = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(80),
  pin: z.string().max(4).optional(),
  tags: z.array(z.string()).default([]),
});
export type ControllerInput = z.infer<typeof controllerInput>;

export const controllerStatus = z.enum(["unknown", "online", "offline"]);
export type ControllerStatus = z.infer<typeof controllerStatus>;

export const controllerUpdate = controllerInput.partial();
export type ControllerUpdate = z.infer<typeof controllerUpdate>;

/** Summary of the device's /json/info, captured at the last successful poll. */
export const deviceSummary = z.object({
  version: z.string(),
  product: z.string().nullable(),
  arch: z.string().nullable(),
  mac: z.string().nullable(),
  ledCount: z.number().int(),
  rgbw: z.boolean(),
  effectCount: z.number().int(),
  customPaletteCount: z.number().int(),
  customPaletteMax: z.number().int(),
  /** Device palette ID of /palette0.json; later slots count down from it. */
  customPaletteBase: z.number().int(),
});
export type DeviceSummary = z.infer<typeof deviceSummary>;

export const controller = controllerInput.omit({ pin: true }).extend({
  id: z.string(),
  hasPin: z.boolean(),
  status: controllerStatus,
  device: deviceSummary.nullable(),
  lastSeen: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type Controller = z.infer<typeof controller>;

/** Live control subset sent to a device from the UI. */
export const quickControl = z.object({
  on: z.boolean().optional(),
  bri: byte.optional(),
  ps: z.number().int().min(1).max(250).optional(),
});
export type QuickControl = z.infer<typeof quickControl>;

/** Events pushed to the UI over SSE. */
export type ServerEvent =
  | { type: "controller.updated"; controllerId: string }
  | { type: "controller.removed"; controllerId: string }
  | { type: "palettes.changed" }
  | { type: "presets.changed" }
  | { type: "sync.completed"; controllerId: string };
