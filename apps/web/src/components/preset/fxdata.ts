/**
 * WLED effect metadata (/json/fxdata), e.g. "!,Duty cycle;!,!;!;01":
 * sliders/options ; color slot labels ; palette ; flags ; defaults.
 * In each list "!" means "use the default label" and an empty entry means "not used".
 */
export type ControlKey = "sx" | "ix" | "c1" | "c2" | "c3" | "o1" | "o2" | "o3";

export interface EffectControls {
  sliders: { key: "sx" | "ix" | "c1" | "c2" | "c3"; label: string }[];
  options: { key: "o1" | "o2" | "o3"; label: string }[];
  colors: string[];
  usesPalette: boolean;
}

const SLIDERS = [
  ["sx", "Speed"],
  ["ix", "Intensity"],
  ["c1", "Custom 1"],
  ["c2", "Custom 2"],
  ["c3", "Custom 3"],
] as const;
const OPTIONS = [
  ["o1", "Option 1"],
  ["o2", "Option 2"],
  ["o3", "Option 3"],
] as const;
const COLORS = ["Primary", "Secondary", "Tertiary"];

export const ALL_CONTROLS: EffectControls = {
  sliders: SLIDERS.map(([key, label]) => ({ key, label })),
  options: OPTIONS.map(([key, label]) => ({ key, label })),
  colors: COLORS,
  usesPalette: true,
};

export function parseFxData(fx: number, data: string | undefined): EffectControls {
  // Solid uses only the primary color.
  if (fx === 0) return { sliders: [], options: [], colors: ["Primary"], usesPalette: false };
  // No metadata (older firmware or usermod effects): show the common controls.
  if (!data) return { ...ALL_CONTROLS, sliders: ALL_CONTROLS.sliders.slice(0, 2), options: [] };

  const [controls = "", colors = "", palette = ""] = data.split(";");
  const entries = controls.split(",");
  const label = (entry: string | undefined, fallback: string) => (entry === "!" ? fallback : entry || null);

  const sliders = SLIDERS.flatMap(([key, fallback], i) => {
    const l = label(entries[i], fallback);
    return l ? [{ key, label: l }] : [];
  });
  const options = OPTIONS.flatMap(([key, fallback], i) => {
    const l = label(entries[i + 5], fallback);
    return l ? [{ key, label: l }] : [];
  });
  const colorLabels = colors.split(",").flatMap((c, i) => {
    const l = label(c, COLORS[i] ?? `Color ${i + 1}`);
    return l ? [l] : [];
  });
  return { sliders, options, colors: colorLabels, usesPalette: palette !== "" };
}
