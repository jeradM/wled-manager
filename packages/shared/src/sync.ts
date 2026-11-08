export type ChangeAction = "create" | "update" | "delete" | "unchanged";

export interface PaletteChange {
  action: ChangeAction;
  slot: number;
  /** Palette ID as seen on the device (255 - slot). */
  deviceId: number;
  path: string;
  /** Library palette in this slot after the sync; absent for deletions. */
  paletteId?: string;
  name?: string;
  /**
   * The device file being overwritten or removed isn't what WLED Manager last wrote there: it was made
   * or edited outside the manager (e.g. in the WLED UI).
   */
  replacesUnmanaged?: boolean;
}

export interface SyncPlan {
  controllerId: string;
  palettes: PaletteChange[];
  presets: PresetChange[];
  warnings: string[];
  /** Library presets that don't go to this controller, and why. */
  skippedPresets: { presetId: string; slot: number; name: string; reason: string }[];
  /** True when applying would change nothing on the device. */
  inSync: boolean;
}

export interface SyncResult {
  controllerId: string;
  applied: number;
  plan: SyncPlan;
}

export interface PresetChange {
  action: ChangeAction;
  slot: number;
  /** Library preset in this slot after the sync; absent for deletions. */
  presetId?: string;
  name: string;
  /** See PaletteChange.replacesUnmanaged. */
  replacesUnmanaged?: boolean;
  warnings?: string[];
}

export interface ImportPalette {
  slot: number;
  deviceId: number;
  stops: import("./schemas.js").PaletteStop[];
  /**
   * "in-library": an identical palette is already in the library and will be linked, not duplicated.
   * "changed": the library palette sync put in this slot differs; importing updates it.
   */
  status: "new" | "in-library" | "changed";
  /** For "changed": the controller's copy isn't what sync last wrote, so it was edited there (otherwise the library is newer). */
  edited?: boolean;
  libraryPaletteId?: string;
  libraryName?: string;
}

export interface ImportPreset {
  slot: number;
  name: string;
  kind: import("./schemas.js").PresetKind;
  /**
   * "identical": sync would write exactly this. "changed": settings differ, and importing pulls just those into
   * the library preset. "conflict": the controller's copy is too different (other segments, or a raw preset),
   * so importing replaces the library preset with it.
   */
  status: "new" | "identical" | "changed" | "conflict";
  /** For "changed" and "conflict": the controller's copy isn't what sync last wrote, so it was edited there (otherwise the library is newer). */
  edited?: boolean;
  /** For "changed": what differs, e.g. "Roof: effect, speed". */
  changes?: string[];
  /** For "changed": changes that can't be pulled, and links importing undoes. */
  notes?: string[];
  libraryPresetId?: string;
  libraryName?: string;
  /** Device custom palette slots this preset uses. */
  paletteSlots: number[];
}

export interface ImportPreview {
  controllerId: string;
  palettes: ImportPalette[];
  presets: ImportPreset[];
}

export interface ImportRequest {
  palettes: number[];
  presets: number[];
}

export interface ImportResult {
  palettesCreated: number;
  palettesUpdated: number;
  palettesLinked: number;
  presetsImported: number;
}
