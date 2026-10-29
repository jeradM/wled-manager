import { isClearMarker, segmentLayers, type Preset, type Segment } from "@wled-manager/shared";

export { isClearMarker };

/** Settings for a segment added in the editor: solid amber. */
export const newSegment = (rgbw: boolean): Segment => ({
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  col: [rgbw ? [255, 160, 0, 0] : [255, 160, 0]],
  pal: 0,
});

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
    .flatMap(segmentLayers)
    .filter((s) => s.fx !== undefined || s.fxName)
    .map((s) => s.fxName ?? effects[s.fx!] ?? `Effect ${s.fx}`);
  return [...new Set(names)];
}
