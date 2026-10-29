import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "expected #rrggbb");
const byte = z.number().int().min(0).max(255);

// ---- Palettes ----

export const paletteStop = z.object({ pos: byte, color: hexColor });
export type PaletteStop = z.infer<typeof paletteStop>;

const paletteStops = z.array(paletteStop).min(2).max(16);

/** Different stops for one controller; it syncs these instead of the palette's own. */
export const paletteVariant = z.object({ controllerId: z.string().min(1), stops: paletteStops });
export type PaletteVariant = z.infer<typeof paletteVariant>;

export const paletteInput = z.object({
  name: z.string().min(1).max(64),
  stops: paletteStops,
  variants: z
    .array(paletteVariant)
    .max(100)
    .refine((v) => new Set(v.map((x) => x.controllerId)).size === v.length, {
      message: "only one version per controller",
    })
    .optional(),
});
export type PaletteInput = z.infer<typeof paletteInput>;

export const palette = paletteInput.extend({
  variants: z.array(paletteVariant),
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

/** How a segment looks: everything but where it is (ID, LEDs, direction, name). */
const layerFields = {
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
  /** How the segment is blended with segments below it (newer firmware). */
  bm: z.number().int().min(0).max(255).optional(),
  /** Grouping: LEDs that show the same pixel. */
  grp: z.number().int().min(1).max(255).optional(),
  /** Spacing: LEDs left off after each group. */
  spc: z.number().int().min(0).max(255).optional(),
  /** Offset: shifts the effect along the segment. */
  of: z.number().int().min(0).max(65535).optional(),
  /**
   * A link to a layered effect (manager only): the layer stands for all of the effect's layers, as they are
   * when the preset is rendered, so presets follow changes to the effect. Its other fields are ignored.
   */
  effectId: z.string().min(1).optional(),
};

/**
 * One look stacked on a segment's LEDs: effect, colors, palette, blend mode, opacity and the rest. Only the
 * fields the editor understands are typed; anything else WLED stores (mi, cct, ...) is kept as-is.
 */
export const layer = z.looseObject(layerFields);
export type Layer = z.infer<typeof layer>;

/**
 * A preset segment. Only the fields the editor understands are typed; everything else WLED stores
 * (rev, mi, cct, n, ...) is kept as-is. All fields are optional, as in WLED itself.
 */
export const segment = z.looseObject({
  id: z.number().int().optional(),
  start: z.number().int().min(0).optional(),
  stop: z.number().int().min(0).optional(),
  ...layerFields,
  /**
   * More layers on the same LEDs, above the segment's own settings (its bottom layer), bottom to top
   * (manager only). Each becomes a WLED segment on the same LEDs when the preset is rendered.
   */
  layers: z.array(layer).max(31).optional(),
  /**
   * The controller-defined segment this one uses (manager only, never sent to controllers). Its start, stop,
   * direction and name come from the definition on each controller when the preset is rendered; on a controller
   * without the definition the segment is left out. The stored values are a copy for reading the preset.
   */
  sid: z.string().min(1).max(40).optional(),
});
export type Segment = z.infer<typeof segment>;

export const presetState = z.looseObject({
  on: z.boolean().optional(),
  bri: byte.optional(),
  transition: z.number().int().min(0).max(65535).optional(),
  /** Transition style when the preset loads (newer firmware). */
  bs: z.number().int().min(0).max(255).optional(),
  mainseg: z.number().int().optional(),
  seg: z.array(segment).max(32),
}).refine((st) => st.seg.reduce((n, s) => n + 1 + (s.layers?.length ?? 0), 0) <= 32, {
  message: "a preset can have at most 32 WLED segments, counting each layer",
  path: ["seg"],
});
export type PresetState = z.infer<typeof presetState>;

/**
 * "state" presets are structured light states the editor can work with. "raw" presets hold any other
 * WLED preset verbatim: API-command presets ("win"), per-LED presets (seg.i), playlists, etc.
 */
export const presetKind = z.enum(["state", "raw"]);
export type PresetKind = z.infer<typeof presetKind>;

/**
 * Segments edited together in the preset editor, by position in state.seg. Kept by the manager only;
 * it isn't sent to controllers.
 */
export const segmentGroup = z.object({
  name: z.string().min(1).max(32),
  members: z.array(z.number().int().min(0).max(31)).max(32),
  /** The WLED segment set the group goes in, when it came from a controller's set; otherwise one is picked. */
  set: z.number().int().min(0).max(3).optional(),
});
export type SegmentGroup = z.infer<typeof segmentGroup>;

/**
 * A layered effect: a stack of layers kept in the library, apart from any preset. Applying it to a segment
 * copies its layers onto the segment.
 */
export const layeredEffectInput = z.object({
  name: z.string().trim().min(1).max(64),
  /** Bottom to top, as WLED draws them. */
  layers: z.array(layer).min(1).max(32),
});
export type LayeredEffectInput = z.infer<typeof layeredEffectInput>;

export const layeredEffect = layeredEffectInput.extend({
  id: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type LayeredEffect = z.infer<typeof layeredEffect>;

export const presetFolder = z.string().trim().min(1).max(40);

/** Moves presets into a group (folder), or out of any (null). */
export const presetFolderMove = z.object({ ids: z.array(z.string()).min(1).max(250), folder: presetFolder.nullable() });
export type PresetFolderMove = z.infer<typeof presetFolderMove>;

const presetFields = {
  slot: z.number().int().min(1).max(250),
  name: z.string().min(1).max(64),
  /** Quick-load label shown on WLED's preset buttons. */
  ql: z.string().max(8).optional(),
  kind: presetKind,
  state: presetState.optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  groups: z.array(segmentGroup).max(32).optional(),
  /** Group the preset is listed under in the app, for organizing only; controllers never see it. */
  folder: presetFolder.optional(),
  /**
   * Controllers the preset syncs to; absent means all of them. Either way, a preset using defined segments
   * only syncs to controllers where at least one of them is defined.
   */
  controllers: z.array(z.string()).min(1).max(100).optional(),
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

/** How the LED locator draws a controller's LEDs. */
export const ledLayout = z.object({
  type: z.enum(["strip", "grid", "ring"]),
  /** LEDs per row for strip and grid layouts. */
  columns: z.number().int().min(1).max(1024),
  /** Grid only: every other row runs backwards, as in a zig-zag wired matrix. */
  serpentine: z.boolean(),
  /** Draw LED 0 at the end instead of the start. */
  reverse: z.boolean(),
});
export type LedLayout = z.infer<typeof ledLayout>;

export const DEFAULT_LED_LAYOUT: LedLayout = { type: "strip", columns: 50, serpentine: false, reverse: false };

/** A labelled LED position, e.g. "roof corner", found with the locator. */
export const ledMarker = z.object({ index: z.number().int().min(0), label: z.string().min(1).max(40) });
export type LedMarker = z.infer<typeof ledMarker>;

/** A run of LEDs: start..stop-1, as in WLED segments. */
export const ledSpan = z
  .object({ start: z.number().int().min(0), stop: z.number().int().min(1) })
  .refine((s) => s.stop > s.start, { message: "stop must be after start" });
export type LedSpan = z.infer<typeof ledSpan>;

/** A labelled selection of LEDs, e.g. "roofline", made with the locator. It may have several runs. */
export const ledRange = z.object({ label: z.string().min(1).max(40), spans: z.array(ledSpan).min(1).max(64) });
export type LedRange = z.infer<typeof ledRange>;

const definitionFields = {
  /** Stable reference used by presets. */
  id: z.string().min(1).max(40),
  name: z.string().max(32).optional(),
};

/**
 * A segment defined on a controller, for presets to use. It covers one run of a labelled range, or it
 * starts at a marker or an LED number and ends at another marker, an LED number, or after a number of LEDs.
 * Markers and ranges are referenced by label so moving them moves the segments built on them. Grouping,
 * spacing and offset are chosen per preset.
 */
export const segmentDefinition = z.union([
  z.object({
    ...definitionFields,
    range: z.string().min(1),
    /** Which run of the range, for ranges with several. */
    span: z.number().int().min(0),
    reverse: z.boolean(),
  }),
  z.object({
    ...definitionFields,
    /** A marker label, or an LED number. */
    start: z.union([z.string().min(1), z.number().int().min(0)]),
    end: z.discriminatedUnion("type", [
      /** Runs towards the marker; includeEnd also lights the marker's own LED. */
      z.object({ type: z.literal("marker"), label: z.string().min(1), includeEnd: z.boolean() }),
      /** Runs towards the LED; includeEnd also lights that LED. */
      z.object({ type: z.literal("led"), index: z.number().int().min(0), includeEnd: z.boolean() }),
      /** Covers |count| LEDs from the start LED; a negative count runs backwards. */
      z.object({ type: z.literal("length"), count: z.number().int().min(-10000).max(10000) }),
    ]),
  }),
]);
export type SegmentDefinition = z.infer<typeof segmentDefinition>;

const controllerFields = {
  name: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  pin: z.string().max(4).optional(),
  tags: z.array(z.string()),
};

export const controllerInput = z.object({
  ...controllerFields,
  port: controllerFields.port.default(80),
  tags: controllerFields.tags.default([]),
});
export type ControllerInput = z.infer<typeof controllerInput>;

export const controllerStatus = z.enum(["unknown", "online", "offline"]);
export type ControllerStatus = z.infer<typeof controllerStatus>;

// Built from the fields without defaults: a partial update must leave omitted fields alone.
export const controllerUpdate = z.object(controllerFields).partial().extend({
  layout: ledLayout.optional(),
  markers: z.array(ledMarker).max(500).optional(),
  ranges: z.array(ledRange).max(200).optional(),
  segments: z
    .array(segmentDefinition)
    .max(200)
    .refine((defs) => new Set(defs.map((d) => d.id)).size === defs.length, { message: "segment IDs must be unique" })
    .optional(),
});
export type ControllerUpdate = z.infer<typeof controllerUpdate>;

export const CONTROLLER_EXPORT_FORMAT = "wled-manager/controller";

/**
 * A controller's manager-side setup, saved to a file to bring it into another WLED Manager. Segment
 * definitions keep their IDs, so presets using them link up again. The settings PIN isn't included.
 */
export const controllerExport = z.object({
  format: z.literal(CONTROLLER_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  controller: z.object({
    name: controllerFields.name,
    host: controllerFields.host,
    port: controllerFields.port,
    tags: controllerFields.tags,
    layout: ledLayout,
    markers: controllerUpdate.shape.markers.unwrap(),
    ranges: controllerUpdate.shape.ranges.unwrap(),
    segments: controllerUpdate.shape.segments.unwrap(),
    /** LED count when exported, to spot a controller wired differently. */
    ledCount: z.number().int().nullable(),
  }),
});
export type ControllerExport = z.infer<typeof controllerExport>;

/** Adds a controller from an export; name, address and PIN can be changed from the file's. */
export const controllerImport = z.object({
  file: controllerExport,
  name: controllerFields.name.optional(),
  host: controllerFields.host.optional(),
  port: controllerFields.port.optional(),
  pin: controllerFields.pin,
  tags: controllerFields.tags.optional(),
});
export type ControllerImport = z.infer<typeof controllerImport>;

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
  /** Most segments the firmware supports. */
  maxSegments: z.number().int(),
});
export type DeviceSummary = z.infer<typeof deviceSummary>;

export const controller = controllerInput.omit({ pin: true }).extend({
  id: z.string(),
  hasPin: z.boolean(),
  status: controllerStatus,
  device: deviceSummary.nullable(),
  lastSeen: z.string().nullable(),
  lastError: z.string().nullable(),
  layout: ledLayout,
  markers: z.array(ledMarker),
  ranges: z.array(ledRange),
  segments: z.array(segmentDefinition),
});
export type Controller = z.infer<typeof controller>;

/** Live control subset sent to a device from the UI. */
export const quickControl = z.object({
  on: z.boolean().optional(),
  bri: byte.optional(),
  ps: z.number().int().min(1).max(250).optional(),
});
export type QuickControl = z.infer<typeof quickControl>;

// ---- Settings ----

export const MIN_POLL_INTERVAL_MS = 5_000;

export const settings = z.object({
  /** How often controllers are polled for status; 0 turns polling off. */
  pollIntervalMs: z
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .refine((ms) => ms === 0 || ms >= MIN_POLL_INTERVAL_MS, { message: "use 0 (off) or at least 5 seconds" }),
});
export type Settings = z.infer<typeof settings>;

/** Events pushed to the UI over SSE. */
export type ServerEvent =
  | { type: "controller.updated"; controllerId: string }
  | { type: "controller.removed"; controllerId: string }
  | { type: "palettes.changed" }
  | { type: "presets.changed" }
  | { type: "effects.changed" }
  | { type: "sync.completed"; controllerId: string }
  | { type: "settings.changed" };
