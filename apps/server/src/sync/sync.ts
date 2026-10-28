import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignPaletteSlots,
  canonicalJson,
  customPaletteId,
  paletteFileName,
  paletteKey,
  paletteStopsFor,
  presetSkipReason,
  renderPreset,
  resolveSegmentRef,
  stopsToWled,
  type DevicePreset,
  type PaletteChange,
  type PaletteStop,
  type PresetChange,
  type PresetInput,
  type SyncPlan,
  type SyncResult,
} from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { controllerPaletteSlots, syncState } from "../db/schema.js";
import type { EventBus } from "../events.js";
import type { ControllerService } from "../services/controllers.js";
import type { PaletteService } from "../services/palettes.js";
import type { PresetService } from "../services/presets.js";
import { hasModernPalettes, type WledClient } from "../wled/client.js";
import { readDevice, type DeviceSnapshot } from "./device.js";
import type { ControllerLocks } from "./locks.js";

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
  device: DeviceSnapshot;
  slots: Record<string, number>;
  desiredPalettes: DesiredPalette[];
  /** Full presets.json contents to write, keyed by slot. */
  desiredPresets: Map<number, DevicePreset>;
}

/**
 * Brings a controller's custom palettes and presets in line with the library: resolve what should be
 * on the device, read what is there, diff, and apply. The manager is the source of truth, so palette
 * files and presets the library doesn't account for are removed.
 */
export class SyncService {
  constructor(
    private db: Db,
    private events: EventBus,
    private locks: ControllerLocks,
    private controllers: ControllerService,
    private palettes: PaletteService,
    private presets: PresetService,
  ) {}

  /**
   * Renders one preset for a controller using its current palette slots, for trying it out live.
   * Library palettes not yet synced to the controller fall back to Default (with a warning).
   */
  renderForDevice(controllerId: string, preset: PresetInput, base: number) {
    const row = this.controllers.getRow(controllerId);
    const slots = new Map(
      this.db
        .select()
        .from(controllerPaletteSlots)
        .where(eq(controllerPaletteSlots.controllerId, controllerId))
        .all()
        .map((r) => [r.paletteId, r.slot]),
    );
    const names = new Map(this.palettes.list().map((p) => [p.id, p.name]));
    return renderPreset(preset, {
      effects: row.effects ?? [],
      devicePalette: (id) => (slots.has(id) ? customPaletteId(slots.get(id)!, base) : undefined),
      paletteName: (id) => names.get(id),
      segment: this.segmentResolver(controllerId),
    });
  }

  /** Looks up defined segments on a controller, falling back to same-named segments for other controllers' definitions. */
  private segmentResolver(controllerId: string) {
    const all = this.controllers.list();
    const target = all.find((c) => c.id === controllerId)!;
    return (sid: string) => resolveSegmentRef(sid, target, all);
  }

  async plan(controllerId: string): Promise<SyncPlan> {
    return (await this.prepare(controllerId)).plan;
  }

  apply(controllerId: string): Promise<SyncResult> {
    return this.locks.run(controllerId, async () => {
      const prepared = await this.prepare(controllerId);
      let applied: number;
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
    });
  }

  private async prepare(controllerId: string): Promise<PreparedSync> {
    let row = this.controllers.getRow(controllerId);
    const client = this.controllers.client(row);
    // Always read the device live: capacity, numbering and contents can change at any time.
    const device = await readDevice(client);
    if (device.info.ver !== row.info?.ver || !row.effects) {
      await this.controllers.refresh(controllerId, { full: true });
      row = this.controllers.getRow(controllerId);
    }
    const state = this.db.select().from(syncState).where(eq(syncState.controllerId, controllerId)).get();
    const warnings: string[] = [];

    // ---- Palettes ----
    const library = this.palettes.list();
    const existing = Object.fromEntries(
      this.db
        .select()
        .from(controllerPaletteSlots)
        .where(eq(controllerPaletteSlots.controllerId, controllerId))
        .all()
        .map((r) => [r.paletteId, r.slot]),
    );
    const { slots, overflow } = assignPaletteSlots(existing, library.map((p) => p.id), device.max);
    if (overflow.length) {
      const names = overflow.map((id) => library.find((p) => p.id === id)?.name).join(", ");
      warnings.push(`Controller holds at most ${device.max} custom palettes; not synced: ${names}`);
    }
    const desiredPalettes: DesiredPalette[] = library
      .filter((p) => slots[p.id] !== undefined)
      .map((p) => ({ slot: slots[p.id]!, paletteId: p.id, name: p.name, stops: paletteStopsFor(p, controllerId) }))
      .sort((a, b) => a.slot - b.slot);

    // A device file that differs from what the manager last wrote to that slot came from elsewhere.
    const writtenPalettes = state?.writtenPalettes ?? {};
    const foreignPalette = (slot: number) => {
      const key = device.palettes.get(slot)?.key;
      return key != null && key === writtenPalettes[slot] ? {} : { replacesUnmanaged: true };
    };
    const paletteChanges: PaletteChange[] = desiredPalettes.map((d) => {
      const onDevice = device.palettes.get(d.slot);
      const action = !onDevice ? "create" : onDevice.key === paletteKey(d.stops) ? "unchanged" : "update";
      return {
        action,
        slot: d.slot,
        deviceId: customPaletteId(d.slot, device.base),
        path: paletteFileName(d.slot),
        paletteId: d.paletteId,
        name: d.name,
        ...(action === "update" ? foreignPalette(d.slot) : {}),
      };
    });
    for (const slot of device.palettes.keys()) {
      if (!desiredPalettes.some((d) => d.slot === slot))
        paletteChanges.push({
          action: "delete",
          slot,
          deviceId: customPaletteId(slot, device.base),
          path: paletteFileName(slot),
          ...foreignPalette(slot),
        });
    }
    paletteChanges.sort((a, b) => a.slot - b.slot);

    // ---- Presets ----
    const paletteNames = new Map(library.map((p) => [p.id, p.name]));
    const renderCtx = {
      effects: row.effects ?? [],
      devicePalette: (id: string) => (slots[id] !== undefined ? customPaletteId(slots[id]!, device.base) : undefined),
      paletteName: (id: string) => paletteNames.get(id),
      segment: this.segmentResolver(controllerId),
    };
    const desiredPresets = new Map<number, DevicePreset>();
    const writtenPresets = state?.writtenPresets ?? {};
    const foreignPreset = (slot: number) => {
      const p = device.presets.get(slot);
      return p && canonicalJson(p) === writtenPresets[slot] ? {} : { replacesUnmanaged: true };
    };
    const sources = this.controllers.list();
    const target = sources.find((c) => c.id === controllerId)!;
    const skippedPresets: SyncPlan["skippedPresets"] = [];
    const presetChanges: PresetChange[] = this.presets.list().flatMap((p): PresetChange[] => {
      const reason = presetSkipReason(p, target, sources);
      if (reason) {
        skippedPresets.push({ presetId: p.id, slot: p.slot, name: p.name, reason });
        return [];
      }
      const { json, warnings: presetWarnings } = renderPreset(p, renderCtx);
      desiredPresets.set(p.slot, json);
      const onDevice = device.presets.get(p.slot);
      const action = !onDevice ? "create" : canonicalJson(onDevice) === canonicalJson(json) ? "unchanged" : "update";
      return [
        {
          action,
          slot: p.slot,
          presetId: p.id,
          name: p.name,
          ...(action === "update" ? foreignPreset(p.slot) : {}),
          ...(presetWarnings.length ? { warnings: presetWarnings } : {}),
        },
      ];
    });
    for (const [slot, p] of device.presets) {
      if (!desiredPresets.has(slot))
        presetChanges.push({
          action: "delete",
          slot,
          name: typeof p.n === "string" ? p.n : `Preset ${slot}`,
          ...foreignPreset(slot),
        });
    }
    presetChanges.sort((a, b) => a.slot - b.slot);

    const plan: SyncPlan = {
      controllerId,
      palettes: paletteChanges,
      presets: presetChanges,
      warnings,
      skippedPresets,
      inSync: [...paletteChanges, ...presetChanges].every((c) => c.action === "unchanged"),
    };
    return { plan, client, device, slots, desiredPalettes, desiredPresets };
  }

  private async execute({ plan, client, device, desiredPalettes, desiredPresets }: PreparedSync): Promise<number> {
    let applied = 0;
    const modern = hasModernPalettes(device.info);
    const fileFor = (slot: number) => JSON.stringify(stopsToWled(desiredPalettes.find((d) => d.slot === slot)!.stops));

    // Palettes first, so presets never point at a palette that isn't there yet.
    // Uploads in ascending slot order keep palette files contiguous while they are written.
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
    if (needsReload && desiredPalettes.length) {
      const first = desiredPalettes[0]!.slot;
      await client.uploadFile(paletteFileName(first), fileFor(first));
    }

    // Presets: the whole file is replaced in one upload. The upload invalidates WLED's preset cache.
    const presetChanges = plan.presets.filter((c) => c.action !== "unchanged").length;
    if (presetChanges) {
      await client.uploadFile("/presets.json", JSON.stringify(presetsFile(desiredPresets)));
      applied += presetChanges;
    }

    return applied;
  }

  private recordSuccess(controllerId: string, { slots, desiredPalettes, desiredPresets }: PreparedSync) {
    const writtenPalettes = Object.fromEntries(desiredPalettes.map((d) => [d.slot, paletteKey(d.stops)]));
    const writtenPresets = Object.fromEntries([...desiredPresets].map(([slot, p]) => [slot, canonicalJson(p)]));
    const hash = createHash("sha256").update(canonicalJson({ writtenPalettes, writtenPresets })).digest("hex");
    const now = new Date().toISOString();
    const state = {
      desiredHash: hash,
      lastAppliedHash: hash,
      lastSyncedAt: now,
      lastError: null,
      drifted: false,
      writtenPalettes,
      writtenPresets,
    };
    this.db.transaction((tx) => {
      tx.delete(controllerPaletteSlots).where(eq(controllerPaletteSlots.controllerId, controllerId)).run();
      const rows = Object.entries(slots).map(([paletteId, slot]) => ({ controllerId, paletteId, slot }));
      if (rows.length) tx.insert(controllerPaletteSlots).values(rows).run();
      tx.insert(syncState).values({ controllerId, ...state }).onConflictDoUpdate({ target: syncState.controllerId, set: state }).run();
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

/** presets.json contents. WLED keeps an empty slot-0 entry at the top of the file. */
export function presetsFile(presets: Map<number, DevicePreset>): Record<string, unknown> {
  const file: Record<string, unknown> = { "0": {} };
  for (const slot of [...presets.keys()].sort((a, b) => a - b)) file[slot] = presets.get(slot);
  return file;
}
