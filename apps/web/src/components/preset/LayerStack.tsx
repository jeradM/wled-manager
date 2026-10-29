import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { resolveLayerLinks, type Layer, type LayeredEffect, type Palette } from "@wled-manager/shared";
import { useLayeredEffects, useWriteLayeredEffect, type Catalog } from "../../queries";
import { LayerEditor, layerEffectName } from "./LayerEditor";
import { newSegment } from "./describe";
import { BLEND_MODES } from "./wled-options";

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
  room = Infinity,
  saveAsEffect = true,
  linkEffects = true,
  catalog,
  library,
  rgbw,
  layerExtra,
  onRemap,
}: {
  /** Bottom to top. */
  layers: Layer[];
  onChange: (layers: Layer[]) => void;
  /** How many more layers fit (each layer is a WLED segment). */
  room?: number;
  /** Offer "Save as a layered effect". */
  saveAsEffect?: boolean;
  /**
   * Apply layered effects as links that follow later changes to the effect (true), or as copies of their
   * layers (false: inside a layered effect, which can't link to another).
   */
  linkEffects?: boolean;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Shown in each layer's header, e.g. the simulator's show toggle; given the layer's index (0 = bottom). */
  layerExtra?: (k: number) => ReactNode;
  /** Called when layers move or go, with each old index's new one (undefined when removed). */
  onRemap?: (map: (k: number) => number | undefined) => void;
}) {
  const { data: effects = [] } = useLayeredEffects();
  const saveEffect = useWriteLayeredEffect();
  const byId = new Map(effects.map((e) => [e.id, e]));
  /** WLED segments a layer takes: a linked effect takes one per layer. */
  const cost = (l: Layer) => (l.effectId !== undefined ? (byId.get(l.effectId)?.layers.length ?? 1) : 1);
  const stackCost = layers.reduce((n, l) => n + cost(l), 0);
  const canAdd = room >= 1;
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
    const [action, id] = v.split(":");
    const effect = effects.find((e) => e.id === id);
    if (action === "blank") insertAbove(top, newLayer(rgbw));
    else if (action === "copy") insertAbove(top, structuredClone(layers[top]!));
    else if (action === "add" && effect) {
      if (linkEffects) insertAbove(top, { effectId: effect.id });
      else update([...layers, ...structuredClone(effect.layers)], (j) => j);
    } else if (action === "replace" && effect) update(linkEffects ? [{ effectId: effect.id }] : structuredClone(effect.layers), () => undefined);
    else if (action === "save") {
      saveEffect.reset();
      setNaming("");
    }
  };
  // "Save as a layered effect": the name being typed.
  const [naming, setNaming] = useState<string | null>(null);
  const save = () => {
    const name = naming?.trim();
    if (!name) return;
    // An effect holds layers, not links: linked effects are saved as copies of their layers.
    const own = resolveLayerLinks(layers, (id) => byId.get(id)?.layers).layers;
    saveEffect.mutate({ input: { name, layers: own } }, { onSuccess: () => setNaming(null) });
  };
  /** Replaces the link at `k` with copies of the effect's layers, to edit them here. */
  const unlink = (k: number, effect: LayeredEffect) => {
    const n = effect.layers.length;
    update([...layers.slice(0, k), ...structuredClone(effect.layers), ...layers.slice(k + 1)], (j) => (j <= k ? j : j + n - 1));
  };

  const allControls = (k: number) => (
    <label className="flex items-center gap-1 text-neutral-400">
      <input type="checkbox" checked={showAll.has(k)} onChange={() => setShowAll(toggle(showAll, k))} />
      All controls
    </label>
  );
  const addPicker = (
    <span className="flex items-center gap-2">
      <select
        value=""
        onChange={(e) => onAdd(e.target.value)}
        aria-label="Add layer"
        title="Add a layer on top (another effect on the same LEDs), or apply a layered effect"
        className="w-fit rounded-md border border-dashed border-neutral-700 bg-transparent px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
      >
        <option value="" disabled>+ Add layer…</option>
        <option value="blank" disabled={!canAdd}>Blank layer (Solid)</option>
        <option value="copy" disabled={cost(layers[layers.length - 1]!) > room}>Copy of the top layer</option>
        {effects.length > 0 && (
          <optgroup label={linkEffects ? "Link a layered effect on top" : "Add a layered effect's layers on top"}>
            {effects.map((e) => (
              <option key={e.id} value={`add:${e.id}`} disabled={e.layers.length > room}>
                {e.name} ({e.layers.length} layer{e.layers.length === 1 ? "" : "s"}){e.layers.length > room ? " – no room" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {effects.length > 0 && (
          <optgroup label={linkEffects ? "Replace these layers with a link to" : "Replace these layers with"}>
            {effects.map((e) => (
              <option key={e.id} value={`replace:${e.id}`} disabled={e.layers.length - stackCost > room}>
                {e.name}
                {e.layers.length - stackCost > room ? " – no room" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {saveAsEffect && (
          <optgroup label="Library">
            <option value="save">Save these layers as a layered effect…</option>
          </optgroup>
        )}
      </select>
      {naming !== null && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            maxLength={64}
            autoFocus
            placeholder="Layered effect name"
            aria-label="Layered effect name"
            className="w-44 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs"
          />
          <button type="submit" disabled={!naming.trim() || saveEffect.isPending} className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40">
            Save
          </button>
          <button type="button" onClick={() => setNaming(null)} className="text-xs text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
        </form>
      )}
      {naming === null && saveEffect.isSuccess && <span className="text-xs text-emerald-400">Saved "{saveEffect.data.name}" to layered effects</span>}
      {saveEffect.isError && <span className="text-xs text-red-400">Couldn't save: {saveEffect.error.message}</span>}
    </span>
  );

  // One layer of its own: the editor as it always was, with a way to add more.
  if (layers.length === 1 && layers[0]!.effectId === undefined)
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
        const linked = l.effectId !== undefined ? byId.get(l.effectId) : undefined;
        const isLink = l.effectId !== undefined;
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
                {isLink ? (
                  <span className="truncate text-violet-300" title="Linked: follows changes to the layered effect">
                    ⛓ {linked ? `${linked.name} · layered effect, ${linked.layers.length} layer${linked.layers.length === 1 ? "" : "s"}` : "missing layered effect"}
                  </span>
                ) : (
                  <span className="truncate text-neutral-400">{layerEffectName(l, catalog)}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {layerExtra?.(k)}
                {!isCollapsed && !isLink && allControls(k)}
                {linked && (
                  <>
                    <Link
                      to="/effects/$id"
                      params={{ id: linked.id }}
                      target="_blank"
                      className="text-sky-400 hover:text-sky-300"
                      title="Edit the layered effect (opens in a new tab). Every preset linked to it follows."
                    >
                      Edit effect
                    </Link>
                    <button
                      type="button"
                      onClick={() => unlink(k, linked)}
                      disabled={linked.layers.length - 1 > room}
                      className="text-sky-400 hover:text-sky-300 disabled:opacity-40"
                      title="Replace the link with copies of the effect's layers, to change them here only"
                    >
                      Unlink
                    </button>
                  </>
                )}
                <button type="button" className={iconButton} onClick={() => move(k, 1)} disabled={top} aria-label={`Move layer ${k + 1} up`} title="Move up (drawn later, on top)">
                  ↑
                </button>
                <button type="button" className={iconButton} onClick={() => move(k, -1)} disabled={k === 0} aria-label={`Move layer ${k + 1} down`} title="Move down (drawn earlier, underneath)">
                  ↓
                </button>
                {canAdd && cost(l) <= room && (
                  <button type="button" onClick={() => insertAbove(k, structuredClone(l))} className="text-sky-400 hover:text-sky-300" title="Add a copy of this layer right above it">
                    Copy
                  </button>
                )}
                {layers.length > 1 && (
                  <button type="button" onClick={() => remove(k)} className="text-red-400 hover:text-red-300">
                    Remove
                  </button>
                )}
              </span>
            </div>
            {!isCollapsed && isLink && (
              <div className="border-t border-neutral-800 px-3 py-2 text-xs text-neutral-400">
                {linked ? (
                  <ol className="space-y-0.5">
                    {linked.layers
                      .map((x, j) => (
                        <li key={j}>
                          <span className="text-neutral-500">{j + 1}.</span> {layerEffectName(x, catalog)}
                          {x.bm !== undefined && x.bm > 0 && ` · ${BLEND_MODES[x.bm] ?? `mode ${x.bm}`}`}
                          {x.bri !== undefined && x.bri < 255 && ` · ${Math.round((x.bri / 255) * 100)}%`}
                        </li>
                      ))
                      .reverse()}
                  </ol>
                ) : (
                  <p className="text-amber-400">This layered effect was deleted; the link adds nothing. Remove it.</p>
                )}
              </div>
            )}
            {!isCollapsed && !isLink && (
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
