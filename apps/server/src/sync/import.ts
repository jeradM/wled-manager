import { and, eq } from "drizzle-orm";
import {
  canonicalJson,
  customPaletteId,
  importPreset,
  isStatePreset,
  pullPreset,
  paletteKey,
  paletteStopsFor,
  remapPresetRefs,
  renderPreset,
  type DevicePreset,
  type ImportPalette,
  type ImportPreset,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type PresetInput,
} from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { controllerPaletteSlots, syncState } from "../db/schema.js";
import type { EventBus } from "../events.js";
import type { ControllerService } from "../services/controllers.js";
import type { PaletteService } from "../services/palettes.js";
import type { PresetService } from "../services/presets.js";
import { readDevice, type DeviceSnapshot } from "./device.js";
import type { ControllerLocks } from "./locks.js";
import type { SyncService } from "./sync.js";

type Read = Awaited<ReturnType<ImportService["read"]>>;

/**
 * Pulls a controller's custom palettes and presets into the library. Only reads from the device. Imported
 * items are recorded as already written to that controller, so the next sync shows them as unchanged.
 */
export class ImportService {
  constructor(
    private db: Db,
    private events: EventBus,
    private locks: ControllerLocks,
    private controllers: ControllerService,
    private palettes: PaletteService,
    private presets: PresetService,
    private sync: SyncService,
  ) {}

  async preview(controllerId: string): Promise<ImportPreview> {
    const read = await this.read(controllerId);
    const palettes = this.paletteStatus(controllerId, read);
    const libraryPalette = (deviceId: number) => palettes.find((p) => p.deviceId === deviceId)?.libraryPaletteId;
    const match = this.presetMatching(controllerId, read, [...read.device.presets.keys()], libraryPalette);
    const presets: ImportPreset[] = [...read.device.presets].map(([slot, raw]) => {
      const m = match(slot, raw);
      return {
        slot,
        name: m.imported.name,
        kind: m.imported.kind,
        status: m.status,
        ...(m.existing ? { libraryPresetId: m.existing.id, libraryName: m.existing.name } : {}),
        ...(m.status === "changed" || m.status === "conflict" ? { edited: m.edited } : {}),
        ...(m.pulled ? { changes: m.pulled.changes, notes: m.pulled.notes } : {}),
        paletteSlots: this.customPaletteSlots(raw, read.device),
      };
    });
    return { controllerId, palettes, presets };
  }

  apply(controllerId: string, request: ImportRequest): Promise<ImportResult> {
    return this.locks.run(controllerId, async () => {
      const read = await this.read(controllerId);
      const { device, name } = read;
      const result: ImportResult = { palettesCreated: 0, palettesUpdated: 0, palettesLinked: 0, presetsImported: 0 };

      // ---- Palettes: link identical library palettes, update changed ones, create the rest ----
      const libraryByDeviceId = new Map<number, string>();
      const wanted = new Set(request.palettes);
      const writtenPalettes: Record<string, string> = {};
      for (const p of this.paletteStatus(controllerId, read)) {
        const key = device.palettes.get(p.slot)!.key!;
        let id = p.libraryPaletteId;
        if (p.status === "in-library") result.palettesLinked++;
        else if (p.status === "changed" && wanted.has(p.slot)) {
          // The controller's own version, when the palette has one; otherwise the palette itself.
          const palette = this.palettes.get(id!);
          const stops = p.stops.slice(0, 16);
          const { id: _, revision, updatedAt, ...input } = palette;
          const own = palette.variants.some((v) => v.controllerId === controllerId);
          this.palettes.update(id!, own ? { ...input, variants: palette.variants.map((v) => (v.controllerId === controllerId ? { ...v, stops } : v)) } : { ...input, stops });
          writtenPalettes[p.slot] = key;
          result.palettesUpdated++;
        } else if (p.status === "new" && wanted.has(p.slot)) {
          id = this.palettes.create({ name: `${name} #${p.slot}`, stops: p.stops.slice(0, 16) }).id;
          result.palettesCreated++;
        }
        if (id) {
          libraryByDeviceId.set(p.deviceId, id);
          this.recordPaletteSlot(controllerId, id, p.slot, key);
        }
      }
      this.mergeSyncState(controllerId, { writtenPalettes });

      // ---- Presets: pull changed settings into matching library presets, replace or add the rest ----
      const libraryPalette = (deviceId: number) => libraryByDeviceId.get(deviceId);
      const writtenPresets: Record<string, string> = {};
      const match = this.presetMatching(controllerId, read, request.presets.filter((s) => device.presets.has(s)), libraryPalette);
      for (const slot of request.presets) {
        const raw = device.presets.get(slot);
        if (!raw) continue;
        const m = match(slot, raw);
        if (m.status === "identical") continue;
        if (m.existing) {
          const { id: _, revision, updatedAt, ...current } = m.existing;
          const keep = { folder: current.folder, sync: current.sync, controllers: current.controllers };
          this.presets.update(m.existing.id, m.pulled ? { ...m.pulled.preset, ...keep } : { ...m.imported, ...keep });
        } else this.presets.upsertBySlot(m.imported);
        writtenPresets[slot] = canonicalJson(raw);
        result.presetsImported++;
      }
      this.mergeSyncState(controllerId, { writtenPresets });

      return result;
    });
  }

  /** The controller's custom palettes, matched to library palettes. */
  private paletteStatus(controllerId: string, { device }: Read): ImportPalette[] {
    const library = this.palettes.list();
    const written = this.syncState(controllerId)?.writtenPalettes ?? {};
    const slotRows = this.db.select().from(controllerPaletteSlots).where(eq(controllerPaletteSlots.controllerId, controllerId)).all();
    return [...device.palettes]
      .filter(([, p]) => p.stops)
      .map(([slot, p]): ImportPalette => {
        const base = { slot, deviceId: customPaletteId(slot, device.base), stops: p.stops! };
        // The palette sync keeps in this slot, if any.
        const own = library.find((l) => slotRows.some((r) => r.slot === slot && r.paletteId === l.id));
        if (own && paletteKey(paletteStopsFor(own, controllerId)) !== p.key)
          return { ...base, status: "changed", edited: p.key !== written[slot], libraryPaletteId: own.id, libraryName: own.name };
        const match = own ?? library.find((l) => paletteKey(paletteStopsFor(l, controllerId)) === p.key);
        return { ...base, status: match ? "in-library" : "new", ...(match ? { libraryPaletteId: match.id, libraryName: match.name } : {}) };
      });
  }

  /**
   * How each controller preset compares with the library preset sync puts in its slot: the same as sync would
   * write, different settings that can be pulled in, or different enough to replace it. `deviceSlots` are the
   * slots that may become new library presets.
   */
  private presetMatching(controllerId: string, { device, effects }: Read, deviceSlots: number[], libraryPalette: (id: number) => string | undefined) {
    const target = this.sync.target(controllerId, device, effects);
    const { libraryPreset, toLibrary } = this.slotMatching(target, deviceSlots);
    const written = this.syncState(controllerId)?.writtenPresets ?? {};
    return (slot: number, raw: DevicePreset) => {
      const imported = toLibrary(importPreset(slot, raw, { effects, libraryPalette }));
      const existing = libraryPreset(slot);
      if (!existing) return { status: "new" as const, imported };
      const rendered = renderPreset(existing, target.renderCtx);
      const edited = canonicalJson(raw) !== written[slot];
      if (canonicalJson(rendered.json) === canonicalJson(raw)) return { status: "identical" as const, imported, existing };
      const { id: _, revision, updatedAt, ...current } = existing;
      const pulled = isStatePreset(raw) ? pullPreset(current, rendered, raw, { effects, libraryPalette }) : null;
      if (!pulled) return { status: "conflict" as const, imported, existing, edited };
      // Nothing the library keeps differs, e.g. only settings WLED adds when saving a preset.
      if (canonicalJson(pulled.preset) === canonicalJson(current)) return { status: "identical" as const, imported, existing };
      return { status: "changed" as const, imported, existing, edited, pulled };
    };
  }

  private syncState(controllerId: string) {
    return this.db.select().from(syncState).where(eq(syncState.controllerId, controllerId)).get();
  }

  private async read(controllerId: string) {
    let row = this.controllers.getRow(controllerId);
    const device = await readDevice(this.controllers.client(row));
    if (device.info.ver !== row.info?.ver || !row.effects) {
      await this.controllers.refresh(controllerId, { full: true });
      row = this.controllers.getRow(controllerId);
    }
    return { device, effects: row.effects ?? [], name: row.name };
  }

  /**
   * Which library preset each device slot holds, and how an imported preset becomes a library one. With assigned
   * slots they're the same numbers. With ordered slots, a device slot holds the library preset sync puts there,
   * and presets new to the library take free library slots (`deviceSlots` are those that may need one), with
   * playlists pointed at the library slots.
   */
  private slotMatching({ going, slotOf, ordered }: ReturnType<SyncService["target"]>, deviceSlots: number[]) {
    const all = this.presets.list();
    if (!ordered) return { libraryPreset: (slot: number) => this.presets.bySlot(slot), toLibrary: (p: PresetInput) => p };
    const atDevice = new Map(going.map((p) => [slotOf(p), p]));
    const used = new Set(all.map((p) => p.slot));
    const librarySlot = new Map<number, number>();
    for (const slot of deviceSlots) {
      const existing = atDevice.get(slot);
      if (existing) librarySlot.set(slot, existing.slot);
      else {
        let free = 1;
        while (used.has(free)) free++;
        if (free > 250) continue;
        used.add(free);
        librarySlot.set(slot, free);
      }
    }
    return {
      libraryPreset: (slot: number) => atDevice.get(slot),
      toLibrary: (p: PresetInput): PresetInput => {
        const slot = librarySlot.get(p.slot) ?? p.slot;
        return p.kind === "raw" ? { ...p, slot, raw: remapPresetRefs(p.raw!, (s) => librarySlot.get(s) ?? atDevice.get(s)?.slot) } : { ...p, slot };
      },
    };
  }

  /** Custom palette slots a device preset references. */
  private customPaletteSlots(raw: Record<string, unknown>, device: DeviceSnapshot): number[] {
    if (!Array.isArray(raw.seg)) return [];
    const slots = raw.seg
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).pal : undefined))
      .filter((pal): pal is number => typeof pal === "number")
      .map((pal) => device.base - pal)
      .filter((slot) => device.palettes.has(slot));
    return [...new Set(slots)];
  }

  /** Records that this palette lives in this slot on the controller, unless either is already mapped. */
  private recordPaletteSlot(controllerId: string, paletteId: string, slot: number, key: string) {
    const rows = this.db
      .select()
      .from(controllerPaletteSlots)
      .where(eq(controllerPaletteSlots.controllerId, controllerId))
      .all();
    if (rows.some((r) => r.paletteId === paletteId || r.slot === slot)) return;
    this.db.insert(controllerPaletteSlots).values({ controllerId, paletteId, slot }).run();
    this.mergeSyncState(controllerId, { writtenPalettes: { [slot]: key } });
  }

  private mergeSyncState(
    controllerId: string,
    add: { writtenPalettes?: Record<string, string>; writtenPresets?: Record<string, string> },
  ) {
    const current = this.db.select().from(syncState).where(eq(syncState.controllerId, controllerId)).get();
    const next = {
      writtenPalettes: { ...current?.writtenPalettes, ...add.writtenPalettes },
      writtenPresets: { ...current?.writtenPresets, ...add.writtenPresets },
    };
    if (current) this.db.update(syncState).set(next).where(and(eq(syncState.controllerId, controllerId))).run();
    else this.db.insert(syncState).values({ controllerId, ...next }).run();
  }
}
