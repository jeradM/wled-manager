import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  CONTROLLER_EXPORT_FORMAT,
  DEFAULT_LED_LAYOUT,
  type Controller,
  type ControllerExport,
  type ControllerImport,
  type ControllerInput,
  type ControllerUpdate,
} from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { controllers } from "../db/schema.js";
import type { EventBus } from "../events.js";
import {
  customPaletteBase,
  DEFAULT_CUSTOM_PALETTE_MAX,
  DEFAULT_MAX_SEGMENTS,
  WledClient,
  type WledClientOptions,
  type WledInfo,
} from "../wled/client.js";

type ControllerRow = typeof controllers.$inferSelect;

export class NotFoundError extends Error {}

type ControllerSetup = Pick<ControllerUpdate, "layout" | "markers" | "ranges" | "segments">;

export function toController(row: ControllerRow): Controller {
  const info = row.info;
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    tags: row.tags,
    hasPin: !!row.pin,
    status: row.status,
    lastSeen: row.lastSeen,
    lastError: row.lastError,
    layout: row.layout ?? DEFAULT_LED_LAYOUT,
    markers: [...row.markers].sort((a, b) => a.index - b.index),
    ranges: row.ranges,
    segments: row.segments,
    device: info
      ? {
          version: info.ver,
          product: info.product ?? null,
          arch: info.arch ?? null,
          mac: info.mac ?? null,
          ledCount: info.leds.count,
          rgbw: info.leds.rgbw ?? false,
          effectCount: info.fxcount ?? row.effects?.length ?? 0,
          customPaletteCount: info.cpalcount ?? 0,
          customPaletteMax: info.cpalmax ?? DEFAULT_CUSTOM_PALETTE_MAX,
          customPaletteBase: customPaletteBase(info),
          maxSegments: info.leds.maxseg ?? DEFAULT_MAX_SEGMENTS,
        }
      : null,
  };
}

export class ControllerService {
  constructor(
    private db: Db,
    private events: EventBus,
    private clientOptions: WledClientOptions = {},
  ) {}

  /**
   * Segment definitions saved before presets referenced them had no IDs and carried grouping, spacing and
   * offset, which are now chosen per preset. Gives them IDs and drops those fields.
   */
  upgradeSegmentDefinitions() {
    for (const row of this.db.select({ id: controllers.id, segments: controllers.segments }).from(controllers).all()) {
      if (row.segments.every((d) => typeof d.id === "string" && !("grp" in d || "spc" in d || "of" in d))) continue;
      const segments = row.segments.map((d) => {
        const { grp: _g, spc: _s, of: _o, ...rest } = d as typeof d & { grp?: number; spc?: number; of?: number };
        return { ...rest, id: typeof d.id === "string" ? d.id : randomUUID() };
      });
      this.db.update(controllers).set({ segments }).where(eq(controllers.id, row.id)).run();
    }
  }

  list(): Controller[] {
    return this.db.select().from(controllers).orderBy(controllers.name).all().map(toController);
  }

  getRow(id: string): ControllerRow {
    const row = this.db.select().from(controllers).where(eq(controllers.id, id)).get();
    if (!row) throw new NotFoundError(`Controller ${id} not found`);
    return row;
  }

  get(id: string): Controller {
    return toController(this.getRow(id));
  }

  client(row: Pick<ControllerRow, "host" | "port">) {
    return new WledClient(row.host, row.port, this.clientOptions);
  }

  /** Adds a controller after confirming a WLED device answers at host:port. Throws WledError if not. */
  async create(input: ControllerInput, setup: ControllerSetup = {}): Promise<Controller> {
    const details = await this.fetchDetails(this.client(input));
    const now = new Date().toISOString();
    const row = this.db
      .insert(controllers)
      .values({ id: randomUUID(), ...input, ...setup, ...details, status: "online", lastSeen: now, lastError: null })
      .returning()
      .get();
    this.events.publish({ type: "controller.updated", controllerId: row.id });
    return toController(row);
  }

  update(id: string, patch: ControllerUpdate): Controller {
    this.getRow(id);
    const row = this.db
      .update(controllers)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(controllers.id, id))
      .returning()
      .get();
    this.events.publish({ type: "controller.updated", controllerId: id });
    return toController(row);
  }

  export(id: string): ControllerExport {
    const c = this.get(id);
    return {
      format: CONTROLLER_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      controller: {
        name: c.name,
        host: c.host,
        port: c.port,
        tags: c.tags,
        layout: c.layout,
        markers: c.markers,
        ranges: c.ranges,
        segments: c.segments,
        ledCount: c.device?.ledCount ?? null,
      },
    };
  }

  /** Adds a controller from an export file, with its layout, markers, ranges and segments. */
  import({ file, ...overrides }: ControllerImport): Promise<Controller> {
    const { layout, markers, ranges, segments, ledCount: _, ...fields } = file.controller;
    const input = { ...fields, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
    return this.create(input, { layout, markers, ranges, segments });
  }

  /** Replaces an existing controller's layout, markers, ranges and segments with an export file's. */
  importSetup(id: string, file: ControllerExport): Controller {
    const { layout, markers, ranges, segments } = file.controller;
    return this.update(id, { layout, markers, ranges, segments });
  }

  remove(id: string) {
    this.getRow(id);
    this.db.delete(controllers).where(eq(controllers.id, id)).run();
    this.events.publish({ type: "controller.removed", controllerId: id });
  }

  /**
   * Polls the device and records online/offline status. A full refresh also re-reads the effect and
   * palette lists; a light one only reads /json/info, re-fetching the lists if the firmware changed.
   */
  async refresh(id: string, { full = false } = {}): Promise<Controller> {
    const row = this.getRow(id);
    const client = this.client(row);
    let set: Partial<ControllerRow>;
    try {
      if (full) {
        set = await this.fetchDetails(client);
      } else {
        const info = await client.getInfo();
        set = info.ver !== row.info?.ver || !row.effects ? await this.fetchDetails(client, info) : { info };
      }
      set = { ...set, status: "online", lastSeen: new Date().toISOString(), lastError: null };
    } catch (e) {
      set = { status: "offline", lastError: e instanceof Error ? e.message : String(e) };
    }

    const updated = this.db.update(controllers).set(set).where(eq(controllers.id, id)).returning().get();
    // /json/info carries volatile fields (uptime, RSSI, heap), so only notify when something shown changed.
    const before = toController(row);
    const after = toController(updated);
    const changed =
      before.status !== after.status ||
      before.lastError !== after.lastError ||
      JSON.stringify(before.device) !== JSON.stringify(after.device) ||
      (full && set.effects !== undefined);
    if (changed) this.events.publish({ type: "controller.updated", controllerId: id });
    return after;
  }

  private async fetchDetails(client: WledClient, info?: WledInfo) {
    return {
      info: info ?? (await client.getInfo()),
      effects: await client.getEffects(),
      palettes: await client.getPalettes(),
      fxdata: await client.getFxData(),
    };
  }
}
