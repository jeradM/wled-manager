import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Controller, ControllerInput, ControllerUpdate } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { controllers } from "../db/schema.js";
import type { EventBus } from "../events.js";
import {
  customPaletteBase,
  DEFAULT_CUSTOM_PALETTE_MAX,
  WledClient,
  type WledClientOptions,
  type WledInfo,
} from "../wled/client.js";

type ControllerRow = typeof controllers.$inferSelect;

export class NotFoundError extends Error {}

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
  async create(input: ControllerInput): Promise<Controller> {
    const details = await this.fetchDetails(this.client(input));
    const now = new Date().toISOString();
    const row = this.db
      .insert(controllers)
      .values({ id: randomUUID(), ...input, ...details, status: "online", lastSeen: now, lastError: null })
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
