import { and, eq } from "drizzle-orm";
import {
  canonicalJson,
  customPaletteId,
  importPreset,
  paletteKey,
  paletteStopsFor,
  segmentSets,
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

/** What decides whether a library preset matches a device preset: its settings and the WLED set each segment goes in. */
const comparable = (p: Pick<PresetInput, "name" | "ql" | "kind" | "state" | "raw" | "groups">) =>
  canonicalJson({
    name: p.name,
    ql: p.ql ?? null,
    kind: p.kind,
    state: p.state ?? null,
    raw: p.raw ?? null,
    sets: (p.state && segmentSets(p.state.seg, p.groups)) ?? null,
  });

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
  ) {}

  async preview(controllerId: string): Promise<ImportPreview> {
    const { device, effects } = await this.read(controllerId);
    const library = this.palettes.list();

    const palettes: ImportPalette[] = [...device.palettes]
      .filter(([, p]) => p.stops)
      .map(([slot, p]) => {
        const match = library.find((l) => paletteKey(paletteStopsFor(l, controllerId)) === p.key);
        return {
          slot,
          deviceId: customPaletteId(slot, device.base),
          stops: p.stops!,
          status: match ? "in-library" : "new",
          ...(match ? { libraryPaletteId: match.id, libraryName: match.name } : {}),
        };
      });

    // For comparison, link device palettes to library palettes that already match.
    const libraryPalette = (deviceId: number) => palettes.find((p) => p.deviceId === deviceId)?.libraryPaletteId;
    const presets: ImportPreset[] = [...device.presets].map(([slot, raw]) => {
      const imported = importPreset(slot, raw, { effects, libraryPalette });
      const existing = this.presets.bySlot(slot);
      const status = !existing ? "new" : comparable(existing) === comparable(imported) ? "identical" : "conflict";
      return {
        slot,
        name: imported.name,
        kind: imported.kind,
        status,
        ...(existing ? { libraryPresetId: existing.id, libraryName: existing.name } : {}),
        paletteSlots: this.customPaletteSlots(raw, device),
      };
    });

    return { controllerId, palettes, presets };
  }

  apply(controllerId: string, request: ImportRequest): Promise<ImportResult> {
    return this.locks.run(controllerId, async () => {
      const { device, effects, name } = await this.read(controllerId);
      const result: ImportResult = { palettesCreated: 0, palettesLinked: 0, presetsImported: 0 };

      // ---- Palettes: link identical library palettes, create the rest ----
      const libraryByDeviceId = new Map<number, string>();
      const library = this.palettes.list();
      const wanted = new Set(request.palettes);
      for (const [slot, p] of device.palettes) {
        if (!p.stops) continue;
        let id = library.find((l) => paletteKey(paletteStopsFor(l, controllerId)) === p.key)?.id;
        if (id) {
          result.palettesLinked++;
        } else if (wanted.has(slot)) {
          id = this.palettes.create({ name: `${name} #${slot}`, stops: p.stops.slice(0, 16) }).id;
          result.palettesCreated++;
        }
        if (id) {
          libraryByDeviceId.set(customPaletteId(slot, device.base), id);
          this.recordPaletteSlot(controllerId, id, slot, p.key!);
        }
      }

      // ---- Presets ----
      const libraryPalette = (deviceId: number) => libraryByDeviceId.get(deviceId);
      const writtenPresets: Record<string, string> = {};
      for (const slot of request.presets) {
        const raw = device.presets.get(slot);
        if (!raw) continue;
        this.presets.upsertBySlot(importPreset(slot, raw, { effects, libraryPalette }));
        writtenPresets[slot] = canonicalJson(raw);
        result.presetsImported++;
      }
      this.mergeSyncState(controllerId, { writtenPresets });

      return result;
    });
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
