import { Link } from "@tanstack/react-router";
import { PLACEMENT_KEYS, type Layer, type Palette } from "@wled-manager/shared";
import type { Catalog } from "../../queries";
import { ColorField } from "./ColorField";
import { EffectPicker } from "./EffectPicker";
import { PalettePicker } from "./PalettePicker";
import { ALL_CONTROLS, parseFxData } from "./fxdata";
import { BLEND_MODES } from "./wled-options";

const TYPED_KEYS = new Set(["on", "bri", "fx", "fxName", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col", "pal", "bm", "grp", "spc", "of"]);

/** The effect a layer uses, by name when the catalog has it (IDs shift between firmware versions). */
export function layerEffect(layer: Layer, catalog: Catalog | undefined): number | undefined {
  const effects = catalog?.effects ?? [];
  return layer.fxName !== undefined && effects.includes(layer.fxName) ? effects.indexOf(layer.fxName) : layer.fx;
}

/** Short name of a layer's effect, for headings. */
export function layerEffectName(layer: Layer, catalog: Catalog | undefined): string {
  const fx = layerEffect(layer, catalog);
  return (fx !== undefined && catalog?.effects[fx]) || layer.fxName || (fx === undefined ? "(unchanged)" : `Effect ${fx}`);
}

/**
 * Edits one layer: how a segment's LEDs look (effect, sliders, colors, palette, blend mode, opacity, grouping).
 * Knows nothing about which LEDs, so it works for any stack of layers.
 */
export function LayerEditor({
  layer: l,
  catalog,
  library,
  rgbw,
  showAll,
  bottom,
  onChange,
}: {
  layer: Layer;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Show every control, not just the ones the effect uses. */
  showAll: boolean;
  /** The bottom layer blends with whatever lies under the segment rather than with another layer. */
  bottom: boolean;
  onChange: (l: Layer) => void;
}) {
  const set = (patch: Partial<Layer>) => onChange({ ...l, ...patch });
  const fx = layerEffect(l, catalog);
  const controls = showAll || fx === undefined ? ALL_CONTROLS : parseFxData(fx, catalog?.fxdata[fx]);
  const extraKeys = Object.keys(l).filter((k) => !TYPED_KEYS.has(k) && !PLACEMENT_KEYS.has(k) && k !== "layers");
  const colorLabels = controls.colors.length ? controls.colors : ["Primary"];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div className="col-span-2 flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Effect</span>
          <EffectPicker
            value={fx}
            savedName={l.fxName}
            effects={catalog?.effects ?? []}
            fxdata={catalog?.fxdata}
            onChange={(id, name) => set({ fx: id, fxName: name })}
          />
        </div>
        <NumberField
          label="Grouping"
          title="LEDs that show the same pixel, so the effect looks coarser"
          value={l.grp}
          min={1}
          max={255}
          onChange={(grp) => set({ grp })}
        />
        <NumberField label="Spacing" title="LEDs left off after each group" value={l.spc} min={0} max={255} onChange={(spc) => set({ spc })} />
        <NumberField
          label="Offset"
          title="Shifts the effect along the segment by this many pixels"
          value={l.of}
          min={0}
          max={65535}
          onChange={(of) => set({ of })}
        />
      </div>

      {controls.sliders.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {controls.sliders.map(({ key, label }) => {
            const max = key === "c3" ? 31 : 255;
            const value = l[key];
            return (
              <label key={key} className="flex flex-col gap-0.5 text-xs">
                <span className="flex justify-between text-neutral-400">
                  {label}
                  <span title={value === undefined ? "Not set: the controller keeps its current value" : undefined}>{value ?? "–"}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={max}
                  value={value ?? Math.round(max / 2)}
                  onChange={(e) => set({ [key]: Number(e.target.value) })}
                  className={`accent-sky-500 ${value === undefined ? "opacity-40" : ""}`}
                />
              </label>
            );
          })}
        </div>
      )}

      {controls.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          {controls.options.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={l[key] ?? false}
                onChange={(e) => set({ [key]: e.target.checked })}
                className={l[key] === undefined ? "opacity-40" : ""}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {colorLabels.map((label, i) => (
          <ColorField
            key={i}
            label={label}
            value={l.col?.[i]}
            rgbw={rgbw}
            onChange={(c) => {
              const col = [...(l.col ?? [])];
              while (col.length < i) col.push(rgbw ? [0, 0, 0, 0] : [0, 0, 0]);
              col[i] = c;
              set({ col });
            }}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_10rem]">
        <div>
          <span className="text-xs text-neutral-400">Palette{!controls.usesPalette && " (this effect doesn't use one)"}</span>
          <PalettePicker value={l.pal} builtins={catalog?.palettes ?? []} library={library} onChange={(pal) => set({ pal })} />
        </div>
        <label className="flex flex-col">
          <span className="flex justify-between text-xs text-neutral-400">
            Blend mode
            <Link
              to="/simulator/blend-modes"
              hash={l.bm !== undefined ? `bm-${l.bm}` : undefined}
              target="_blank"
              title="What each blend mode does (opens in a new tab)"
              className="text-sky-400 hover:text-sky-300"
            >
              ?
            </Link>
          </span>
          <select
            value={l.bm ?? ""}
            onChange={(e) => set({ bm: e.target.value === "" ? undefined : Number(e.target.value) })}
            title={`How this layer combines with ${bottom ? "segments under it" : "the layers below it"}. Needs recent WLED firmware.`}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            <option value="">(unchanged)</option>
            {BLEND_MODES.map((label, value) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {l.bm !== undefined && l.bm >= BLEND_MODES.length && <option value={l.bm}>Mode {l.bm}</option>}
          </select>
        </label>
        <label
          className="flex flex-col gap-1"
          title={`Layer opacity (WLED's segment brightness). Below 100% the layer is mixed with ${bottom ? "segments under it" : "the layers below it"}.`}
        >
          <span className="flex justify-between text-xs text-neutral-400">
            Opacity
            <span title={l.bri === undefined ? "Not set: the controller keeps its current value" : undefined}>
              {l.bri === undefined ? "–" : `${Math.round((l.bri / 255) * 100)}%`}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={255}
            value={l.bri ?? 255}
            onChange={(e) => set({ bri: Number(e.target.value) })}
            className={`mt-1.5 accent-sky-500 ${l.bri === undefined ? "opacity-40" : ""}`}
          />
        </label>
      </div>

      {extraKeys.length > 0 && <p className="mt-3 text-xs text-neutral-500">Also kept as-is: {extraKeys.join(", ")}</p>}
    </div>
  );
}

/** Number input where empty means "leave the controller's value alone". */
export function NumberField({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1" title={title}>
      <span className="text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        placeholder="keep"
        onChange={(e) =>
          onChange(e.target.value.trim() === "" ? undefined : Math.min(max, Math.max(min, Math.round(Number(e.target.value)) || min)))
        }
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
      />
    </label>
  );
}
