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
  warnings: string[];
  /** True when applying would change nothing on the device. */
  inSync: boolean;
}

export interface SyncResult {
  controllerId: string;
  applied: number;
  plan: SyncPlan;
}
