import type { Preset, Segment } from "@wled-manager/shared";

/**
 * WLED saves {"stop": 0} entries for unused segment slots; loading the preset clears those segments.
 * They carry no settings of their own.
 */
export const isClearMarker = (s: Segment) =>
  s.stop === 0 && Object.keys(s).every((k) => k === "stop" || k === "id");

export const realSegments = (p: Preset) => (p.kind === "state" ? p.state!.seg.filter((s) => !isClearMarker(s)) : []);

/** One-line description of a raw preset's type. */
export function rawKind(raw: Record<string, unknown> | undefined): string {
  if (!raw) return "Raw";
  if ("playlist" in raw) return "Playlist";
  if ("win" in raw) return `API command: ${String(raw.win)}`;
  if (raw.seg && typeof raw.seg === "object" && !Array.isArray(raw.seg) && "i" in raw.seg) return "Individual LEDs";
  return "Raw JSON";
}

export function effectNames(p: Preset, effects: string[]): string[] {
  if (p.kind !== "state") return [];
  const names = realSegments(p)
    .filter((s) => s.fx !== undefined || s.fxName)
    .map((s) => s.fxName ?? effects[s.fx!] ?? `Effect ${s.fx}`);
  return [...new Set(names)];
}
