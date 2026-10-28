import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LedMarker, Palette, Segment } from "@wled-manager/shared";
import type { Catalog } from "../../queries";
import { ColorField } from "./ColorField";
import { EffectPicker } from "./EffectPicker";
import { PalettePicker } from "./PalettePicker";
import { ALL_CONTROLS, parseFxData } from "./fxdata";
import { BLEND_MODES } from "./wled-options";

const TYPED_KEYS = new Set(["id", "start", "stop", "on", "bri", "fx", "fxName", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col", "pal", "bm", "grp", "spc", "of", "sid"]);
/** Set from the definition on segments that use one. */
const DEFINED_KEYS = new Set(["rev", "n"]);

interface Props {
  index: number;
  segment: Segment;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Labelled LED positions on the source controller, suggested for start/stop. */
  markers: LedMarker[];
  onChange: (s: Segment) => void;
  onRemove?: () => void;
  /** Heading; defaults to "Segment <id>". */
  title?: ReactNode;
  /** Shown before the heading, e.g. a drag handle. */
  leading?: ReactNode;
  /** Shown in the header next to the controls, e.g. a group picker. */
  headerExtra?: ReactNode;
  /** Where the segment's LEDs come from, shown above the settings. */
  source?: ReactNode;
  /** Hide start/stop: when editing several segments at once, or when a defined segment sets them. */
  hideGeometry?: boolean;
  /** Left border color, e.g. the segment's group. */
  accent?: string;
}

const numberOrUndefined = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.round(Number(v)) || 0));

export function SegmentEditor({
  index,
  segment: s,
  catalog,
  library,
  rgbw,
  markers,
  onChange,
  onRemove,
  title,
  leading,
  headerExtra,
  source,
  hideGeometry,
  accent,
}: Props) {
  const markerList = `segment-markers-${index}`;
  const [showAll, setShowAll] = useState(false);
  const set = (patch: Partial<Segment>) => onChange({ ...s, ...patch });
  const effects = catalog?.effects ?? [];
  const fx = s.fxName !== undefined && effects.includes(s.fxName) ? effects.indexOf(s.fxName) : s.fx;
  const controls = showAll || fx === undefined ? ALL_CONTROLS : parseFxData(fx, catalog?.fxdata[fx]);
  const extraKeys = Object.keys(s).filter((k) => !TYPED_KEYS.has(k) && !(s.sid && DEFINED_KEYS.has(k)));
  const colorLabels = controls.colors.length ? controls.colors : ["Primary"];

  return (
    <div
      className={`rounded-lg border border-neutral-800 p-3 ${accent ? "border-l-4" : ""}`}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {leading}
          {title ?? `Segment ${s.id ?? index}`}
        </span>
        <div className="flex items-center gap-3 text-xs">
          {headerExtra}
          <label className="flex items-center gap-1 text-neutral-400">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            All controls
          </label>
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">Remove</button>
          )}
        </div>
      </div>

      {source && <div className="mb-3 text-sm">{source}</div>}

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Effect</span>
          <EffectPicker
            value={fx}
            savedName={s.fxName}
            effects={effects}
            fxdata={catalog?.fxdata}
            onChange={(id, name) => set({ fx: id, fxName: name })}
          />
        </div>
        {!hideGeometry && (
          <>
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
          </>
        )}
        <NumberField
          label="Grouping"
          title="LEDs that show the same pixel, so the effect looks coarser"
          value={s.grp}
          min={1}
          max={255}
          onChange={(grp) => set({ grp })}
        />
        <NumberField
          label="Spacing"
          title="LEDs left off after each group"
          value={s.spc}
          min={0}
          max={255}
          onChange={(spc) => set({ spc })}
        />
        <NumberField
          label="Offset"
          title="Shifts the effect along the segment by this many pixels"
          value={s.of}
          min={0}
          max={65535}
          onChange={(of) => set({ of })}
        />
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

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_10rem]">
        <div>
          <span className="text-xs text-neutral-400">
            Palette{!controls.usesPalette && " (this effect doesn't use one)"}
          </span>
          <PalettePicker value={s.pal} builtins={catalog?.palettes ?? []} library={library} onChange={(pal) => set({ pal })} />
        </div>
        <label className="flex flex-col">
          <span className="flex justify-between text-xs text-neutral-400">
            Blend mode
            <Link
              to="/simulator/blend-modes"
              hash={s.bm !== undefined ? `bm-${s.bm}` : undefined}
              target="_blank"
              title="What each blend mode does (opens in a new tab)"
              className="text-sky-400 hover:text-sky-300"
            >
              ?
            </Link>
          </span>
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
        <label
          className="flex flex-col gap-1"
          title="Segment opacity (WLED's segment brightness). Below 100% the segment is mixed with the segments under it."
        >
          <span className="flex justify-between text-xs text-neutral-400">
            Opacity
            <span title={s.bri === undefined ? "Not set: the controller keeps its current value" : undefined}>
              {s.bri === undefined ? "–" : `${Math.round((s.bri / 255) * 100)}%`}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={255}
            value={s.bri ?? 255}
            onChange={(e) => set({ bri: Number(e.target.value) })}
            className={`mt-1.5 accent-sky-500 ${s.bri === undefined ? "opacity-40" : ""}`}
          />
        </label>
      </div>

      {extraKeys.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500">Also kept as-is: {extraKeys.join(", ")}</p>
      )}
    </div>
  );
}

/** Number input where empty means "leave the controller's value alone". */
function NumberField({
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
