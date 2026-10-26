import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignPaletteSlots,
  customPaletteId,
  paletteFileName,
  paletteKey,
  stopsToWled,
  wledToStops,
  type PaletteChange,
  type PaletteStop,
  type SyncPlan,
  type SyncResult,
} from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { controllerPaletteSlots, syncState } from "../db/schema.js";
import type { EventBus } from "../events.js";
import type { ControllerService } from "../services/controllers.js";
import type { PaletteService } from "../services/palettes.js";
import { customPaletteBase, DEFAULT_CUSTOM_PALETTE_MAX, hasModernPalettes, WledClient, type WledInfo } from "../wled/client.js";

export class SyncConflictError extends Error {}

interface DesiredPalette {
  slot: number;
  paletteId: string;
  name: string;
  stops: PaletteStop[];
}

/** Everything needed to show a plan and, if confirmed, apply it. */
interface PreparedSync {
  plan: SyncPlan;
  client: WledClient;
  info: WledInfo;
  slots: Record<string, number>;
  desired: DesiredPalette[];
}

const PALETTE_FILE = /^palette(\d+)\.json$/;

/**
 * Brings a controller's custom palettes in line with the library: resolve what should be on the device,
 * read what is there, diff, and apply. The manager is the source of truth, so palette files that the
 * library doesn't account for are removed.
 */
export class SyncService {
  private running = new Set<string>();

  constructor(
    private db: Db,
    private events: EventBus,
    private controllers: ControllerService,
    private palettes: PaletteService,
  ) {}

  async plan(controllerId: string): Promise<SyncPlan> {
    return (await this.prepare(controllerId)).plan;
  }

  async apply(controllerId: string): Promise<SyncResult> {
    if (this.running.has(controllerId)) throw new SyncConflictError("A sync is already running for this controller");
    this.running.add(controllerId);
    try {
      const prepared = await this.prepare(controllerId);
      let applied = 0;
      try {
        applied = await this.execute(prepared);
        this.recordSuccess(controllerId, prepared);
      } catch (e) {
        this.recordError(controllerId, e);
        throw e;
      }
      await this.controllers.refresh(controllerId).catch(() => {});
      this.events.publish({ type: "sync.completed", controllerId });
      return { controllerId, applied, plan: prepared.plan };
    } finally {
      this.running.delete(controllerId);
    }
  }

  private async prepare(controllerId: string): Promise<PreparedSync> {
    const row = this.controllers.getRow(controllerId);
    const client = this.controllers.client(row);
    // Always read live info: capacity and palette numbering can change with a firmware update.
    const info = await client.getInfo();
    const max = info.cpalmax ?? DEFAULT_CUSTOM_PALETTE_MAX;
    const base = customPaletteBase(info);
    const warnings: string[] = [];

    // Resolve
    const library = this.palettes.list();
    const existing = Object.fromEntries(
      this.db
        .select()
        .from(controllerPaletteSlots)
        .where(eq(controllerPaletteSlots.controllerId, controllerId))
        .all()
        .map((r) => [r.paletteId, r.slot]),
    );
    const { slots, overflow } = assignPaletteSlots(existing, library.map((p) => p.id), max);
    if (overflow.length) {
      const names = overflow.map((id) => library.find((p) => p.id === id)?.name).join(", ");
      warnings.push(`Controller holds at most ${max} custom palettes; not synced: ${names}`);
    }
    const desired: DesiredPalette[] = library
      .filter((p) => slots[p.id] !== undefined)
      .map((p) => ({ slot: slots[p.id]!, paletteId: p.id, name: p.name, stops: p.stops }))
      .sort((a, b) => a.slot - b.slot);

    // Fetch
    const deviceSlots = (await client.listFiles())
      .map((f) => PALETTE_FILE.exec(f.name)?.[1])
      .filter((s): s is string => s !== undefined)
      .map(Number);
    const onDevice = new Map<number, string | null>();
    for (const slot of deviceSlots) {
      const file = await client.getFileJson(paletteFileName(slot)).catch(() => null);
      let key: string | null = null;
      try {
        key = file ? paletteKey(wledToStops(file)) : null;
      } catch {
        // Unparseable file: treat as different so it gets rewritten.
      }
      onDevice.set(slot, key);
    }

    // Diff. A device file that differs from what the manager last wrote to that slot came from elsewhere.
    const written =
      this.db.select().from(syncState).where(eq(syncState.controllerId, controllerId)).get()?.writtenPalettes ?? {};
    const unmanaged = (slot: number) =>
      onDevice.get(slot) !== null && onDevice.get(slot) === written[slot] ? {} : { replacesUnmanaged: true };
    const changes: PaletteChange[] = desired.map((d) => {
      const action = !onDevice.has(d.slot)
        ? "create"
        : onDevice.get(d.slot) === paletteKey(d.stops)
          ? "unchanged"
          : "update";
      return {
        action,
        slot: d.slot,
        deviceId: customPaletteId(d.slot, base),
        path: paletteFileName(d.slot),
        paletteId: d.paletteId,
        name: d.name,
        ...(action === "update" ? unmanaged(d.slot) : {}),
      };
    });
    for (const slot of onDevice.keys()) {
      if (!desired.some((d) => d.slot === slot))
        changes.push({
          action: "delete",
          slot,
          deviceId: customPaletteId(slot, base),
          path: paletteFileName(slot),
          ...unmanaged(slot),
        });
    }
    changes.sort((a, b) => a.slot - b.slot);

    const plan: SyncPlan = {
      controllerId,
      palettes: changes,
      warnings,
      inSync: changes.every((c) => c.action === "unchanged"),
    };
    return { plan, client, info, slots, desired };
  }

  private async execute({ plan, client, info, desired }: PreparedSync): Promise<number> {
    let applied = 0;
    const modern = hasModernPalettes(info);
    const fileFor = (slot: number) => JSON.stringify(stopsToWled(desired.find((d) => d.slot === slot)!.stops));

    // Uploads in ascending slot order so palette files stay contiguous while they are written.
    for (const c of plan.palettes.filter((c) => c.action === "create" || c.action === "update")) {
      await client.uploadFile(c.path, fileFor(c.slot));
      applied++;
    }

    // Then trailing removals, highest first.
    let needsReload = false;
    for (const c of plan.palettes.filter((c) => c.action === "delete").reverse()) {
      const { reloaded } = await client.removeCustomPalette(c.slot, modern);
      needsReload ||= !reloaded;
      applied++;
    }

    // Older firmware only re-reads palettes on a palette upload, so re-upload one to drop the removed ones.
    if (needsReload && desired.length) await client.uploadFile(paletteFileName(desired[0]!.slot), fileFor(desired[0]!.slot));

    return applied;
  }

  private recordSuccess(controllerId: string, { slots, desired }: PreparedSync) {
    const writtenPalettes = Object.fromEntries(desired.map((d) => [d.slot, paletteKey(d.stops)]));
    const hash = createHash("sha256").update(JSON.stringify(writtenPalettes)).digest("hex");
    const now = new Date().toISOString();
    const state = { desiredHash: hash, lastAppliedHash: hash, lastSyncedAt: now, lastError: null, drifted: false, writtenPalettes };
    this.db.transaction((tx) => {
      tx.delete(controllerPaletteSlots).where(eq(controllerPaletteSlots.controllerId, controllerId)).run();
      const rows = Object.entries(slots).map(([paletteId, slot]) => ({ controllerId, paletteId, slot }));
      if (rows.length) tx.insert(controllerPaletteSlots).values(rows).run();
      tx.insert(syncState)
        .values({ controllerId, ...state })
        .onConflictDoUpdate({ target: syncState.controllerId, set: state })
        .run();
    });
  }

  private recordError(controllerId: string, e: unknown) {
    const lastError = e instanceof Error ? e.message : String(e);
    this.db
      .insert(syncState)
      .values({ controllerId, lastError })
      .onConflictDoUpdate({ target: syncState.controllerId, set: { lastError } })
      .run();
  }
}
