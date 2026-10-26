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

/** A preset points at a WLED built-in palette by ID, or at a library palette resolved per device at sync time. */
export const paletteRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), id: z.number().int().min(0).max(245) }),
  z.object({ kind: z.literal("custom"), paletteId: z.string() }),
]);
export type PaletteRef = z.infer<typeof paletteRef>;

export const segment = z.object({
  start: z.number().int().min(0).optional(),
  stop: z.number().int().min(0).optional(),
  fx: z.number().int().min(0),
  fxName: z.string().optional(),
  sx: byte.default(128),
  ix: byte.default(128),
  c1: byte.default(128),
  c2: byte.default(128),
  c3: z.number().int().min(0).max(31).default(16),
  o1: z.boolean().default(false),
  o2: z.boolean().default(false),
  o3: z.boolean().default(false),
  col: z.tuple([hexColor, hexColor, hexColor]),
  pal: paletteRef,
});
export type Segment = z.infer<typeof segment>;

export const presetState = z.object({
  on: z.boolean().default(true),
  bri: byte.default(128),
  transition: z.number().int().min(0).max(65535).default(7),
  seg: z.array(segment).min(1).max(32),
});
export type PresetState = z.infer<typeof presetState>;

export const presetInput = z.object({
  slot: z.number().int().min(1).max(250),
  name: z.string().min(1).max(64),
  ql: z.string().max(2).optional(),
  state: presetState,
});
export type PresetInput = z.infer<typeof presetInput>;

export const preset = presetInput.extend({
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
  | { type: "controller.removed"; controllerId: string };
