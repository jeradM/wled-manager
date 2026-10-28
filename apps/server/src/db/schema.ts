import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LedLayout, LedMarker, LedRange, PaletteStop, PaletteVariant, PresetState, SegmentDefinition, SegmentGroup } from "@wled-manager/shared";
import type { WledInfo } from "../wled/client.js";

const timestamps = {
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
};

export const controllers = sqliteTable("controllers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(80),
  pin: text("pin"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["unknown", "online", "offline"] }).notNull().default("unknown"),
  /** Cached /json/info, effect/palette name lists and effect metadata from the last refresh. */
  info: text("info", { mode: "json" }).$type<WledInfo>(),
  effects: text("effects", { mode: "json" }).$type<string[]>(),
  palettes: text("palettes", { mode: "json" }).$type<string[]>(),
  fxdata: text("fxdata", { mode: "json" }).$type<string[]>(),
  lastSeen: text("last_seen"),
  lastError: text("last_error"),
  /** LED locator drawing settings; null means the default layout. */
  layout: text("layout", { mode: "json" }).$type<LedLayout>(),
  markers: text("markers", { mode: "json" }).$type<LedMarker[]>().notNull().default([]),
  /** Labelled LED selections made with the locator. */
  ranges: text("ranges", { mode: "json" }).$type<LedRange[]>().notNull().default([]),
  /** Segments defined for presets to use, built from markers and ranges. */
  segments: text("segment_plan", { mode: "json" }).$type<SegmentDefinition[]>().notNull().default([]),
  ...timestamps,
});

export const palettes = sqliteTable("palettes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stops: text("stops", { mode: "json" }).$type<PaletteStop[]>().notNull(),
  /** Controller-specific versions: different stops under the same name. */
  variants: text("variants", { mode: "json" }).$type<PaletteVariant[]>().notNull().default([]),
  /** Sync priority: lower positions get slots first when a controller runs out of room. */
  position: integer("position").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
});

export const presets = sqliteTable("presets", {
  id: text("id").primaryKey(),
  slot: integer("slot").notNull().unique(),
  name: text("name").notNull(),
  ql: text("ql"),
  kind: text("kind", { enum: ["state", "raw"] }).notNull().default("state"),
  /** Set for "state" presets. */
  state: text("state", { mode: "json" }).$type<PresetState>(),
  /** Set for "raw" presets: the device preset JSON without n/ql. */
  raw: text("raw", { mode: "json" }).$type<Record<string, unknown>>(),
  /** Segment groups for the editor; never sent to controllers. */
  groups: text("groups", { mode: "json" }).$type<SegmentGroup[]>(),
  /** Group the preset is listed under in the app; never sent to controllers. */
  folder: text("folder"),
  /** Controllers the preset syncs to; null means all. */
  controllerIds: text("controller_ids", { mode: "json" }).$type<string[]>(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
});

/** Which controllers a library item syncs to: all controllers, or those carrying any of the tags. */
export const targets = sqliteTable(
  "targets",
  {
    itemType: text("item_type", { enum: ["palette", "preset"] }).notNull(),
    itemId: text("item_id").notNull(),
    allControllers: integer("all_controllers", { mode: "boolean" }).notNull().default(true),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.itemType, t.itemId] })],
);

/** Stable palette -> /paletteN.json slot per controller, so device palette IDs don't shuffle. */
export const controllerPaletteSlots = sqliteTable(
  "controller_palette_slots",
  {
    controllerId: text("controller_id")
      .notNull()
      .references(() => controllers.id, { onDelete: "cascade" }),
    paletteId: text("palette_id")
      .notNull()
      .references(() => palettes.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.controllerId, t.paletteId] })],
);

export const syncState = sqliteTable("sync_state", {
  controllerId: text("controller_id")
    .primaryKey()
    .references(() => controllers.id, { onDelete: "cascade" }),
  desiredHash: text("desired_hash"),
  lastAppliedHash: text("last_applied_hash"),
  observedHash: text("observed_hash"),
  drifted: integer("drifted", { mode: "boolean" }).notNull().default(false),
  /** Palette files as last written by the manager: slot -> normalized contents (paletteKey). */
  writtenPalettes: text("written_palettes", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  /** Presets as last written by the manager: slot -> canonical JSON. */
  writtenPresets: text("written_presets", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  lastError: text("last_error"),
  lastSyncedAt: text("last_synced_at"),
});

/** App settings changed from the UI, one JSON value per key. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});
