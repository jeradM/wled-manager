import { customPaletteId, palxToStops, paletteFileName, stopsToWled, type PaletteStop, type PalxEntry } from "@wled-manager/shared";
import type { ControllerService } from "./controllers.js";
import { customPaletteBase, DEFAULT_CUSTOM_PALETTE_MAX, WledError } from "../wled/client.js";

export interface BuiltinPalette {
  id: number;
  name: string;
  /** Null for palettes derived from segment colors or randomness, which can't be copied. */
  stops: PaletteStop[] | null;
}

/** Device-backed palette helpers: built-in palette colors (for "start from") and live previews. */
export class PaletteTools {
  private builtinCache = new Map<string, BuiltinPalette[]>();

  constructor(private controllers: ControllerService) {}

  async builtinPalettes(controllerId: string): Promise<BuiltinPalette[]> {
    const row = this.controllers.getRow(controllerId);
    const names = row.palettes ?? [];
    const cacheKey = `${controllerId}:${row.info?.ver}`;
    const cached = this.builtinCache.get(cacheKey);
    if (cached) return cached;

    const client = this.controllers.client(row);
    const entries: Record<string, PalxEntry> = {};
    let last = 0;
    for (let page = 0; page <= last; page++) {
      const res = await client.getPalx(page);
      last = res.m;
      Object.assign(entries, res.p);
    }
    const result = names.map((name, id) => ({
      id,
      name,
      stops: entries[id] ? palxToStops(entries[id]!) : null,
    }));
    this.builtinCache.set(cacheKey, result);
    return result;
  }

  /**
   * Shows unsaved palette stops on the device: writes them to a spare palette slot just past the
   * device's existing palette files and applies it to the selected segments. The next sync removes
   * the spare file.
   */
  async preview(controllerId: string, stops: PaletteStop[]): Promise<{ slot: number; deviceId: number }> {
    const client = this.controllers.client(this.controllers.getRow(controllerId));
    const info = await client.getInfo();
    const max = info.cpalmax ?? DEFAULT_CUSTOM_PALETTE_MAX;
    const used = (await client.listFiles())
      .map((f) => /^palette(\d+)\.json$/.exec(f.name)?.[1])
      .filter((s): s is string => s !== undefined)
      .map(Number);
    const slot = used.length ? Math.max(...used) + 1 : 0;
    if (slot >= max) throw new WledError("No free custom palette slot on this controller for a preview", 409);

    const deviceId = customPaletteId(slot, customPaletteBase(info));
    await client.uploadFile(paletteFileName(slot), JSON.stringify(stopsToWled(stops)));
    await client.setState({ seg: { pal: deviceId } });
    return { slot, deviceId };
  }
}
