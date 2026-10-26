import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { PaletteStop, PresetState } from "@wled-manager/shared";
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
  ...timestamps,
});

export const palettes = sqliteTable("palettes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stops: text("stops", { mode: "json" }).$type<PaletteStop[]>().notNull(),
  revision: integer("revision").notNull().default(1),
  ...timestamps,
});

export const presets = sqliteTable("presets", {
  id: text("id").primaryKey(),
  slot: integer("slot").notNull().unique(),
  name: text("name").notNull(),
  ql: text("ql"),
  state: text("state", { mode: "json" }).$type<PresetState>().notNull(),
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
  lastError: text("last_error"),
  lastSyncedAt: text("last_synced_at"),
});
