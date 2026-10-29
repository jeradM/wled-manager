import { useState, type ReactNode } from "react";
import type { Layer, Palette } from "@wled-manager/shared";
import type { Catalog } from "../../queries";
import { LayerEditor, layerEffectName } from "./LayerEditor";
import { newSegment } from "./describe";

/** A layer added with "+ Add layer": solid amber, blended normally. */
export const newLayer = (rgbw: boolean): Layer => ({ ...newSegment(rgbw), bm: 0 });

const iconButton = "px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30 disabled:hover:text-neutral-400";

/**
 * A stack of layers drawn on the same LEDs, listed top layer first as in image editors. `layers` runs bottom
 * to top, as WLED draws them. Independent of any segment, so any stack of layers can use it.
 */
export function LayerStack({
  layers,
  onChange,
  canAdd,
  catalog,
  library,
  rgbw,
  layerExtra,
  onRemap,
}: {
  /** Bottom to top. */
  layers: Layer[];
  onChange: (layers: Layer[]) => void;
  /** Whether there's room for another layer (each layer is a WLED segment). */
  canAdd: boolean;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Shown in each layer's header, e.g. the simulator's show toggle; given the layer's index (0 = bottom). */
  layerExtra?: (k: number) => ReactNode;
  /** Called when layers move or go, with each old index's new one (undefined when removed). */
  onRemap?: (map: (k: number) => number | undefined) => void;
}) {
  // By layer index (0 = bottom).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState<Set<number>>(new Set());
  const toggle = (set: Set<number>, k: number) => {
    const next = new Set(set);
    if (!next.delete(k)) next.add(k);
    return next;
  };
  /** Index sets after layers move: `map` gives each old index's new one (undefined when removed). */
  const remap = (set: Set<number>, map: (k: number) => number | undefined) =>
    new Set([...set].flatMap((k) => (map(k) === undefined ? [] : [map(k)!])));
  const update = (next: Layer[], map: (k: number) => number | undefined) => {
    onChange(next);
    onRemap?.(map);
    setCollapsed(remap(collapsed, map));
    setShowAll(remap(showAll, map));
  };

  const setLayer = (k: number, l: Layer) => onChange(layers.map((x, j) => (j === k ? l : x)));
  /** Puts `l` right above layer `k`. */
  const insertAbove = (k: number, l: Layer) =>
    update([...layers.slice(0, k + 1), l, ...layers.slice(k + 1)], (j) => (j > k ? j + 1 : j));
  const remove = (k: number) => update(layers.filter((_, j) => j !== k), (j) => (j === k ? undefined : j > k ? j - 1 : j));
  /** Swaps layer `k` with the one above it (`d` = 1) or below (`d` = -1). */
  const move = (k: number, d: 1 | -1) => {
    const next = [...layers];
    [next[k], next[k + d]] = [next[k + d]!, next[k]!];
    update(next, (j) => (j === k ? k + d : j === k + d ? k : j));
  };
  const onAdd = (v: string) => {
    const top = layers.length - 1;
    if (v === "blank") insertAbove(top, newLayer(rgbw));
    else if (v === "copy") insertAbove(top, structuredClone(layers[top]!));
  };

  const allControls = (k: number) => (
    <label className="flex items-center gap-1 text-neutral-400">
      <input type="checkbox" checked={showAll.has(k)} onChange={() => setShowAll(toggle(showAll, k))} />
      All controls
    </label>
  );
  // Later: "Apply effect…" entries add an effect's layers here.
  const addPicker = (
    <select
      value=""
      onChange={(e) => onAdd(e.target.value)}
      disabled={!canAdd}
      aria-label="Add layer"
      title={canAdd ? "Add a layer on top: another effect on the same LEDs" : "No room: each layer is a WLED segment"}
      className="w-fit rounded-md border border-dashed border-neutral-700 bg-transparent px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
    >
      <option value="" disabled>+ Add layer…</option>
      <option value="blank">Blank layer (Solid)</option>
      <option value="copy">Copy of the top layer</option>
    </select>
  );

  // One layer: the editor as it always was, with a way to add more.
  if (layers.length === 1)
    return (
      <div className="space-y-3">
        <LayerEditor layer={layers[0]!} catalog={catalog} library={library} rgbw={rgbw} showAll={showAll.has(0)} bottom onChange={(l) => setLayer(0, l)} />
        <div className="flex items-center gap-3 text-xs">
          {addPicker}
          {allControls(0)}
          {layerExtra?.(0)}
        </div>
      </div>
    );

  const order = layers.map((_, k) => k).reverse();
  return (
    <div className="space-y-2">
      {addPicker}
      {order.map((k) => {
        const l = layers[k]!;
        const isCollapsed = collapsed.has(k);
        const top = k === layers.length - 1;
        return (
          <div key={k} className="rounded-md border border-neutral-800 bg-neutral-900/40">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed(toggle(collapsed, k))}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} layer ${k + 1}`}
                  className="text-neutral-400 hover:text-neutral-100"
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <span className="font-medium text-neutral-200">
                  Layer {k + 1}
                  {top ? " (top)" : k === 0 ? " (bottom)" : ""}
                </span>
                <span className="truncate text-neutral-400">{layerEffectName(l, catalog)}</span>
              </span>
              <span className="flex items-center gap-2">
                {layerExtra?.(k)}
                {!isCollapsed && allControls(k)}
                <button type="button" className={iconButton} onClick={() => move(k, 1)} disabled={top} aria-label={`Move layer ${k + 1} up`} title="Move up (drawn later, on top)">
                  ↑
                </button>
                <button type="button" className={iconButton} onClick={() => move(k, -1)} disabled={k === 0} aria-label={`Move layer ${k + 1} down`} title="Move down (drawn earlier, underneath)">
                  ↓
                </button>
                {canAdd && (
                  <button type="button" onClick={() => insertAbove(k, structuredClone(l))} className="text-sky-400 hover:text-sky-300" title="Add a copy of this layer right above it">
                    Copy
                  </button>
                )}
                <button type="button" onClick={() => remove(k)} className="text-red-400 hover:text-red-300">
                  Remove
                </button>
              </span>
            </div>
            {!isCollapsed && (
              <div className="border-t border-neutral-800 p-3">
                <LayerEditor layer={l} catalog={catalog} library={library} rgbw={rgbw} showAll={showAll.has(k)} bottom={k === 0} onChange={(x) => setLayer(k, x)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
