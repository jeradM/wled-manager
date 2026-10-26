import { useState } from "react";
import type { LedMarker, Palette, Segment } from "@wled-manager/shared";
import type { Catalog } from "../../queries";
import { ColorField } from "./ColorField";
import { PalettePicker } from "./PalettePicker";
import { ALL_CONTROLS, parseFxData } from "./fxdata";
import { BLEND_MODES } from "./wled-options";

const TYPED_KEYS = new Set(["id", "start", "stop", "on", "bri", "fx", "fxName", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col", "pal", "bm"]);

interface Props {
  index: number;
  segment: Segment;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Labelled LED positions on the source controller, suggested for start/stop. */
  markers: LedMarker[];
  onChange: (s: Segment) => void;
  onRemove: () => void;
}

const numberOrUndefined = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.round(Number(v)) || 0));

export function SegmentEditor({ index, segment: s, catalog, library, rgbw, markers, onChange, onRemove }: Props) {
  const markerList = `segment-markers-${index}`;
  const [showAll, setShowAll] = useState(false);
  const set = (patch: Partial<Segment>) => onChange({ ...s, ...patch });
  const effects = catalog?.effects ?? [];
  const fx = s.fxName !== undefined && effects.includes(s.fxName) ? effects.indexOf(s.fxName) : s.fx;
  const controls = showAll || fx === undefined ? ALL_CONTROLS : parseFxData(fx, catalog?.fxdata[fx]);
  const extraKeys = Object.keys(s).filter((k) => !TYPED_KEYS.has(k));
  const colorLabels = controls.colors.length ? controls.colors : ["Primary"];

  return (
    <div className="rounded-lg border border-neutral-800 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Segment {s.id ?? index}</span>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-neutral-400">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            All controls
          </label>
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">Remove</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Effect</span>
          <select
            value={fx ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              set({ fx: id, fxName: effects[id] });
            }}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            {fx === undefined && <option value="">(unchanged)</option>}
            {fx !== undefined && fx >= effects.length && <option value={fx}>{s.fxName ?? `Effect ${fx}`}</option>}
            {effects.map((name, id) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Start LED</span>
          <input
            value={s.start ?? ""}
            onChange={(e) => set({ start: numberOrUndefined(e.target.value) })}
            list={markerList}
            placeholder="keep"
            inputMode="numeric"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Stop LED</span>
          <input
            value={s.stop ?? ""}
            onChange={(e) => set({ stop: numberOrUndefined(e.target.value) })}
            list={markerList}
            placeholder="keep"
            inputMode="numeric"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        <datalist id={markerList}>
          {markers.map((m) => (
            <option key={m.index} value={m.index}>{m.label}</option>
          ))}
        </datalist>
      </div>

      {controls.sliders.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {controls.sliders.map(({ key, label }) => {
            const max = key === "c3" ? 31 : 255;
            const value = s[key];
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
                checked={s[key] ?? false}
                onChange={(e) => set({ [key]: e.target.checked })}
                className={s[key] === undefined ? "opacity-40" : ""}
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
            value={s.col?.[i]}
            rgbw={rgbw}
            onChange={(c) => {
              const col = [...(s.col ?? [])];
              while (col.length < i) col.push(rgbw ? [0, 0, 0, 0] : [0, 0, 0]);
              col[i] = c;
              set({ col });
            }}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <span className="text-xs text-neutral-400">
            Palette{!controls.usesPalette && " (this effect doesn't use one)"}
          </span>
          <PalettePicker value={s.pal} builtins={catalog?.palettes ?? []} library={library} onChange={(pal) => set({ pal })} />
        </div>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-400">Blend mode</span>
          <select
            value={s.bm ?? ""}
            onChange={(e) => set({ bm: e.target.value === "" ? undefined : Number(e.target.value) })}
            title="How this segment combines with segments below it. Needs recent WLED firmware."
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            <option value="">(unchanged)</option>
            {BLEND_MODES.map((label, value) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {s.bm !== undefined && s.bm >= BLEND_MODES.length && <option value={s.bm}>Mode {s.bm}</option>}
          </select>
        </label>
      </div>

      {extraKeys.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500">Also kept as-is: {extraKeys.join(", ")}</p>
      )}
    </div>
  );
}
