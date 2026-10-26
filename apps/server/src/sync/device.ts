import { paletteFileName, paletteKey, wledToStops, type DevicePreset, type PaletteStop } from "@wled-manager/shared";
import { customPaletteBase, DEFAULT_CUSTOM_PALETTE_MAX, type WledClient, type WledInfo } from "../wled/client.js";

export interface DevicePalette {
  /** Null when the file couldn't be parsed. */
  stops: PaletteStop[] | null;
  key: string | null;
}

export interface DeviceSnapshot {
  info: WledInfo;
  /** Device palette ID of slot 0. */
  base: number;
  max: number;
  palettes: Map<number, DevicePalette>;
  /** Presets by slot, excluding WLED's slot-0 placeholder. */
  presets: Map<number, DevicePreset>;
}

const PALETTE_FILE = /^palette(\d+)\.json$/;

/** Reads everything sync and import compare against: info, custom palette files and presets. GETs only. */
export async function readDevice(client: WledClient): Promise<DeviceSnapshot> {
  const info = await client.getInfo();

  const palettes = new Map<number, DevicePalette>();
  const slots = (await client.listFiles())
    .map((f) => PALETTE_FILE.exec(f.name)?.[1])
    .filter((s): s is string => s !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  for (const slot of slots) {
    let stops: PaletteStop[] | null = null;
    try {
      const file = await client.getFileJson(paletteFileName(slot));
      stops = file ? wledToStops(file) : null;
    } catch {
      // Unparseable or unreadable: treated as different from anything the library has.
    }
    palettes.set(slot, { stops, key: stops ? paletteKey(stops) : null });
  }

  const presets = new Map<number, DevicePreset>();
  for (const [slot, p] of Object.entries(await client.getPresets())) {
    const n = Number(slot);
    if (n >= 1 && n <= 250 && p && typeof p === "object") presets.set(n, p);
  }

  return {
    info,
    base: customPaletteBase(info),
    max: info.cpalmax ?? DEFAULT_CUSTOM_PALETTE_MAX,
    palettes,
    presets,
  };
}
