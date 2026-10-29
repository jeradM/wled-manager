import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  applyGroupEdit,
  canonicalJson,
  duplicateSegment,
  keepPadding,
  removeGroupMember,
  renumberSegments,
  resolveEffectLinks,
  segmentLayers,
  wledSegmentCount,
  withLayers,
  type PresetInput,
  type PresetState,
  type Segment,
  type SegmentGroup,
} from "@wled-manager/shared";
import { SIM_EFFECTS } from "@wled-manager/shared/sim";
import { CATALOG, LedCanvas, isHidden, segmentName, simEffect, type Hidden } from "../components/sim/LedCanvas";
import { useLayeredEffects, usePalettes, usePresets, useWritePreset } from "../queries";
import { SegmentEditor } from "../components/preset/SegmentEditor";
import { copyName, isClearMarker, newSegment } from "../components/preset/describe";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

const COUNT_KEY = "simLedCount";
const RGBW_KEY = "simRgbw";
const MAX_LEDS = 2000;
const scratchState = (): PresetState => ({ on: true, bri: 128, seg: [{ id: 0, fx: 0, col: [[255, 170, 0]], pal: 0 }] });
const savedLedCount = () => {
  const n = Number(localStorage.getItem(COUNT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= MAX_LEDS ? n : 60;
};

/** Hidden switches after segments move: `map` gives each old position its new one (undefined when removed). */
const remapSegments = (hidden: Hidden, map: (i: number) => number | undefined): Hidden =>
  new Set(
    [...hidden].flatMap((key) => {
      const [i, k] = key.split(".");
      const to = map(Number(i));
      return to === undefined ? [] : [k === undefined ? `${to}` : `${to}.${k}`];
    }),
  );
/** Hidden switches after segment `i`'s layers move. */
const remapLayers = (hidden: Hidden, i: number, map: (k: number) => number | undefined): Hidden =>
  new Set(
    [...hidden].flatMap((key) => {
      const [j, k] = key.split(".");
      if (Number(j) !== i || k === undefined) return [key];
      const to = map(Number(k));
      return to === undefined ? [] : [`${i}.${to}`];
    }),
  );

/** Runs WLED effects in the browser on a strip of simulated LEDs, independent of any controller. */
export function Simulator() {
  const { preset: presetId } = useSearch({ from: "/simulator" });
  const navigate = useNavigate();
  const { data: presets = [] } = usePresets();
  const { data: palettes = [] } = usePalettes();
  const { data: layeredEffects = [] } = useLayeredEffects();
  /** Layers of a layered effect, for segments linked to one. */
  const effectLayers = (id: string) => layeredEffects.find((e) => e.id === id)?.layers;
  const write = useWritePreset();

  const [count, setCount] = useState(savedLedCount);
  const [countText, setCountText] = useState(String(count));
  const [paused, setPaused] = useState(false);
  // White channel: shown on RGBW strips, dropped on RGB ones. Follows the preset's colors until chosen here.
  const [rgbwChoice, setRgbwChoice] = useState<boolean | null>(() => {
    const v = localStorage.getItem(RGBW_KEY);
    return v === null ? null : v === "1";
  });
  const loaded = presets.find((p) => p.id === presetId && p.kind === "state");
  const [state, setState] = useState<PresetState>(scratchState);
  // Segment groups by position in state.seg, as in the preset editor.
  const [groups, setGroups] = useState<SegmentGroup[]>([]);
  /** The saved state and groups, to tell whether there are unsaved changes and to revert to. */
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const snapshot = (st: PresetState, gs: SegmentGroup[] | undefined) => canonicalJson({ state: st, groups: gs ?? [] });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // By position in state.seg. Simulator only: neither is saved with the preset.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<Hidden>(new Set());
  const toggleIn = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (!next.delete(i)) next.add(i);
    return next;
  };
  const toggleKey = (set: Hidden, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  /** Positions after removing the segment at `i`. */
  const without = (set: Set<number>, i: number) => new Set([...set].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)));
  // Links to layered effects run as the effects' layers; hidden segments and layers are switched off.
  const resolved = useMemo(() => resolveEffectLinks(state.seg, effectLayers), [state, layeredEffects]); // eslint-disable-line react-hooks/exhaustive-deps
  const simState = useMemo(
    () => ({
      ...state,
      seg: resolved.seg.map((s, i) => {
        if (!hidden.size || isClearMarker(s)) return s;
        const from = resolved.sources[i]!;
        return withLayers(s, segmentLayers(s).map((l, j) => (isHidden(hidden, i, from[j]?.layer ?? j) ? { ...l, on: false } : l)));
      }),
    }),
    [state, resolved, hidden],
  );
  /** How the LED details name segment i's resolved layer j, and whether it's hidden in the simulator. */
  const layerInfo = (i: number, j: number) => {
    const from = resolved.sources[i]?.[j];
    const k = from?.layer ?? j;
    const effect = from?.effectId !== undefined ? layeredEffects.find((e) => e.id === from.effectId) : undefined;
    const stacked = !!state.seg[i]?.layers?.length || from?.effectId !== undefined;
    return {
      label: stacked ? `Layer ${k + 1}${effect ? ` · ${effect.name}, layer ${from!.effectLayer! + 1}` : ""}` : undefined,
      hidden: isHidden(hidden, i, k),
    };
  };

  // Load the chosen preset once it arrives (and again after switching presets).
  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || loadedId.current === loaded.id) return;
    loadedId.current = loaded.id;
    setState(structuredClone(loaded.state!));
    setGroups(structuredClone(loaded.groups ?? []));
    setSavedJson(snapshot(loaded.state!, loaded.groups));
    setSavedAt(null);
    setCollapsed(new Set());
    setHidden(new Set());
  }, [loaded]);
  const dirty = savedJson !== null && snapshot(state, groups) !== savedJson;

  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  const choosePreset = (id: string) => {
    if (dirty && !confirm("Discard your changes to this preset?")) return;
    loadedId.current = null;
    if (!id) {
      setState(scratchState());
      setGroups([]);
      setSavedJson(null);
      setCollapsed(new Set());
      setHidden(new Set());
    }
    void navigate({ to: "/simulator", search: id ? { preset: id } : {} });
  };

  const save = () => {
    if (!loaded) return;
    const { id, revision: _r, updatedAt: _u, groups: _g, ...input } = loaded;
    write.mutate(
      { id, input: { ...input, state, ...(groups.length ? { groups } : {}) } },
      {
        onSuccess: (p) => {
          setSavedJson(snapshot(p.state!, p.groups));
          setSavedAt(new Date().toLocaleTimeString());
        },
      },
    );
  };

  // "Save as new preset": name and slot, while the form is open.
  const [creating, setCreating] = useState<{ name: string; slot: number } | null>(null);
  const freeSlot = () => {
    const used = new Set(presets.map((p) => p.slot));
    for (let slot = 1; slot <= 250; slot++) if (!used.has(slot)) return slot;
    return 250;
  };
  const slotTaken = creating ? presets.find((p) => p.slot === creating.slot) : undefined;
  /** The simulator's setup as a preset, leaving out segments hidden in the simulator. */
  const newPresetState = (): { state: PresetState; groups: SegmentGroup[] } => {
    // Hidden layers go; a segment goes when it or all of its layers are hidden.
    let seg = state.seg.map((s, i) => {
      const layers = segmentLayers(s);
      return isClearMarker(s) || wholeHidden(i) ? s : withLayers(s, layers.filter((_, k) => !isHidden(hidden, i, k)));
    });
    let presetGroups = groups;
    // As in the preset editor: with clear markers present, a removed segment becomes one, keeping positions (IDs).
    const markers = seg.some(isClearMarker);
    const gone = state.seg.flatMap((s, i) => (!isClearMarker(s) && wholeHidden(i) ? [i] : []));
    for (const i of gone.sort((a, b) => b - a)) {
      if (markers) seg[i] = { id: seg[i]!.id ?? i, stop: 0 };
      else seg = seg.filter((_, j) => j !== i);
      presetGroups = removeGroupMember(presetGroups, i, !markers);
    }
    // A preset padded to turn other segments off stays at its WLED length.
    seg = keepPadding(state.seg, seg, effectLayers);
    const next = markers ? { ...state, seg } : renumberSegments({ ...state, seg });
    return { state: next, groups: presetGroups.filter((g) => g.members.length > 0) };
  };
  /** Whether segment `i` is hidden outright or layer by layer. */
  const wholeHidden = (i: number) => segmentLayers(state.seg[i]!).every((_, k) => isHidden(hidden, i, k));
  const kept = state.seg.filter((s, i) => !isClearMarker(s) && !wholeHidden(i)).length;
  const create = () => {
    if (!creating) return;
    const { state: presetState, groups: presetGroups } = newPresetState();
    const input: PresetInput = {
      slot: creating.slot,
      name: creating.name.trim(),
      kind: "state",
      state: presetState,
      ...(presetGroups.length ? { groups: presetGroups } : {}),
      // A copy of a preset stays in its group and goes to the same controllers.
      ...(loaded?.folder ? { folder: loaded.folder } : {}),
      ...(loaded?.controllers ? { controllers: loaded.controllers } : {}),
    };
    write.mutate(
      { input },
      {
        onSuccess: (p) => {
          setCreating(null);
          loadedId.current = null;
          void navigate({ to: "/simulator", search: { preset: p.id } });
        },
      },
    );
  };

  const commitCount = (text: string) => {
    const n = Math.min(MAX_LEDS, Math.max(1, Math.round(Number(text)) || count));
    setCount(n);
    setCountText(String(n));
    localStorage.setItem(COUNT_KEY, String(n));
  };

  const segments = state.seg;
  const groupOf = (i: number) => groups.find((g) => g.members.includes(i));
  const setSegment = (i: number, next: Segment) => {
    const g = groupOf(i);
    // A segment in a group shares its settings with the group, as in the preset editor; its LEDs stay its own.
    const seg = g ? applyGroupEdit(segments, g.members, settingsOnly(segments[i]!), settingsOnly(next)) : [...segments];
    seg[i] = next;
    setState({ ...state, seg: keepPadding(segments, seg, effectLayers) });
  };
  const real = segments.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const realCount = real.length;
  /** WLED segments the setup renders to, one per layer. */
  const used = wledSegmentCount(real.map((p) => segments[p]!), effectLayers);
  /** Adds a copy of segment `i` right below it, in its group. Real segments move ahead of clear markers. */
  const copySegment = (i: number) => {
    const copied = duplicateSegment(state, groups, i);
    const at = real.indexOf(i);
    const moved = (set: Set<number>) => new Set([...set].flatMap((p) => (real.includes(p) ? [real.indexOf(p) + (real.indexOf(p) > at ? 1 : 0)] : [])));
    setState({ ...copied.state, seg: keepPadding(segments, copied.state.seg, effectLayers) });
    setGroups(copied.groups);
    setHidden(remapSegments(hidden, (p) => (real.includes(p) ? real.indexOf(p) + (real.indexOf(p) > at ? 1 : 0) : undefined)));
    setCollapsed(moved(collapsed));
  };
  const rgbw = rgbwChoice ?? segments.some((s) => s.col?.some((c) => Array.isArray(c) && c.length === 4));
  const statePresets = presets.filter((p) => p.kind === "state").sort((a, b) => a.slot - b.slot);
  const unsimulated = segments.flatMap((s, i) =>
    isClearMarker(s)
      ? []
      : segmentLayers(s).flatMap((l, k) => {
          const fx = simEffect(l);
          const where = `${segmentName(s, i)}${s.layers?.length ? `, layer ${k + 1}` : ""}`;
          return fx === undefined || SIM_EFFECTS.has(fx) ? [] : [`${where}: ${l.fxName ?? `effect ${fx}`}`];
        }),
  );
  const outside = segments.filter((s) => !isClearMarker(s) && (s.start ?? 0) >= count).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Simulator"
        actions={
          <>
            <select
              value={loaded?.id ?? ""}
              onChange={(e) => choosePreset(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
              aria-label="Preset"
            >
              <option value="">Scratch (no preset)</option>
              {statePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.slot}. {p.name}
                </option>
              ))}
            </select>
            {loaded && (
              <>
                <Button
                  onClick={() => {
                    if (!savedJson) return;
                    const saved = JSON.parse(savedJson) as { state: PresetState; groups: SegmentGroup[] };
                    setState(saved.state);
                    setGroups(saved.groups);
                  }}
                  disabled={!dirty}
                >
                  Revert
                </Button>
                <Button variant="primary" onClick={save} disabled={!dirty || write.isPending}>
                  Save to preset
                </Button>
              </>
            )}
            <Button
              variant={loaded ? "secondary" : "primary"}
              onClick={() => setCreating({ name: loaded ? copyName(loaded.name, presets) : "", slot: freeSlot() })}
              disabled={!!creating}
            >
              Save as new preset
            </Button>
          </>
        }
      />
      <ErrorText error={write.error} />
      {creating && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="min-w-64 flex-1">
              <Input
                label="Name"
                value={creating.name}
                maxLength={64}
                autoFocus
                onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              />
            </div>
            <div className="w-24">
              <Input
                label="Slot"
                type="number"
                min={1}
                max={250}
                value={creating.slot}
                onChange={(e) => setCreating({ ...creating, slot: Math.min(250, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
              />
            </div>
            <Button type="button" onClick={() => setCreating(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!creating.name.trim() || !!slotTaken || kept === 0 || write.isPending}>
              Create preset
            </Button>
            <p className="w-full text-xs text-neutral-400">
              {slotTaken ? (
                <span className="text-red-400">Slot {creating.slot} is used by "{slotTaken.name}".</span>
              ) : kept === 0 ? (
                <span className="text-red-400">Every segment is hidden; show at least one to make a preset.</span>
              ) : (
                <>
                  Saves the current settings with {kept} segment{kept === 1 ? "" : "s"}
                  {hidden.size > 0 && ", leaving out what's hidden in the simulator"}.
                  {loaded && dirty && ` "${loaded.name}" keeps its saved settings.`}
                </>
              )}
            </p>
          </form>
        </Card>
      )}

      <Card className="sticky top-0 z-30 space-y-3 shadow-lg shadow-black/60">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">LEDs</span>
            <input
              type="number"
              min={1}
              max={MAX_LEDS}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              onBlur={(e) => commitCount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCount(e.currentTarget.value)}
              className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <label className="flex min-w-48 flex-col gap-1">
            <span className="flex justify-between text-xs text-neutral-400">
              Brightness <span>{state.bri ?? 128}</span>
            </span>
            <input
              type="range"
              min={1}
              max={255}
              value={state.bri ?? 128}
              onChange={(e) => setState({ ...state, bri: Number(e.target.value) })}
              className="accent-sky-500"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={state.on !== false} onChange={(e) => setState({ ...state, on: e.target.checked })} />
            On
          </label>
          <label className="flex items-center gap-1.5" title="RGBW strips light the white channel; RGB strips ignore it">
            <input
              type="checkbox"
              checked={rgbw}
              onChange={(e) => {
                setRgbwChoice(e.target.checked);
                localStorage.setItem(RGBW_KEY, e.target.checked ? "1" : "0");
              }}
            />
            RGBW
          </label>
          <Button onClick={() => setPaused(!paused)}>{paused ? "Play" : "Pause"}</Button>
          <Link to="/simulator/blend-modes" className="text-xs text-sky-400 hover:text-sky-300">
            Blend mode guide
          </Link>
          <span className="ml-auto text-xs text-neutral-500">
            {loaded ? (dirty ? "Unsaved changes" : savedAt ? `Saved at ${savedAt}` : `Editing preset ${loaded.slot}`) : "Not linked to a preset"}
          </span>
        </div>
        <LedCanvas state={simState} count={count} palettes={palettes} paused={paused} whiteLeds={rgbw} layerInfo={layerInfo} />
        {(unsimulated.length > 0 || outside > 0) && (
          <ul className="space-y-0.5 text-xs text-amber-400">
            {unsimulated.map((u) => (
              <li key={u}>{u} isn't simulated (2D, audio-reactive and particle effects aren't ported); it shows as Solid.</li>
            ))}
            {outside > 0 && (
              <li>
                {outside} segment{outside === 1 ? " starts" : "s start"} past LED {count}, so {outside === 1 ? "it isn't" : "they aren't"} shown. Raise the LED count to see {outside === 1 ? "it" : "them"}.
              </li>
            )}
          </ul>
        )}
      </Card>

      <div className="space-y-3">
        <div className="flex justify-end gap-3 text-xs">
          <button type="button" className="text-sky-400 hover:text-sky-300" onClick={() => setCollapsed(new Set(segments.map((_, i) => i)))}>
            Collapse all
          </button>
          <button type="button" className="text-sky-400 hover:text-sky-300" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
        </div>
        {segments.map((s, i) => {
          if (isClearMarker(s)) return null;
          const isCollapsed = collapsed.has(i);
          const chevron = (
            <button
              type="button"
              onClick={() => setCollapsed(toggleIn(collapsed, i))}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${segmentName(s, i)}`}
              className="text-neutral-400 hover:text-neutral-100"
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          );
          const showToggle = (
            <label
              className="flex items-center gap-1 text-xs text-neutral-400"
              title="Turn this segment off in the simulator only. Not saved to the preset."
            >
              <input type="checkbox" checked={!hidden.has(`${i}`)} onChange={() => setHidden(toggleKey(hidden, `${i}`))} />
              Show in sim
            </label>
          );
          const title = (
            <>
              {segmentName(s, i)}
              {groupOf(i) && <span className="ml-2 text-xs text-neutral-500">group {groupOf(i)!.name}</span>}
            </>
          );
          if (isCollapsed) {
            const fxNames = segmentLayers(s)
              .map((l) => {
                const fx = simEffect(l);
                return (fx !== undefined && CATALOG.effects[fx]) || l.fxName || (fx === undefined ? "(unchanged)" : `Effect ${fx}`);
              })
              .reverse()
              .join(" over ");
            return (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm ${wholeHidden(i) ? "opacity-50" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {chevron}
                  <span className="font-medium">{title}</span>
                  <span className="truncate text-xs text-neutral-400">
                    {fxNames} · LEDs {s.start ?? 0}–{(s.stop ?? count) - 1}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {showToggle}
                  {used + wledSegmentCount([s], effectLayers) <= 32 && (
                    <button type="button" onClick={() => copySegment(i)} className="text-sky-400 hover:text-sky-300" title="Add a copy of this segment right below it">
                      Copy
                    </button>
                  )}
                </span>
              </div>
            );
          }
          return (
            <div key={i} className={wholeHidden(i) ? "opacity-60" : undefined}>
              <SegmentEditor
                index={i}
                segment={s}
                catalog={CATALOG}
                library={palettes}
                rgbw={rgbw}
                markers={[]}
                title={title}
                leading={chevron}
                headerExtra={showToggle}
                source={
                  s.sid ? (
                    <span className="text-xs text-neutral-400">
                      Defined segment, LEDs {s.start ?? 0}–{(s.stop ?? count) - 1} on the controller it was saved from
                    </span>
                  ) : undefined
                }
                hideGeometry={!!s.sid}
                onChange={(next) => setSegment(i, next)}
                onCopy={used + wledSegmentCount([s], effectLayers) <= 32 ? () => copySegment(i) : undefined}
                layerRoom={32 - used}
                onLayerRemap={(map) => setHidden(remapLayers(hidden, i, map))}
                layerExtra={
                  s.layers?.length
                    ? (k) => (
                        <label className="flex items-center gap-1 text-neutral-400" title="Turn this layer off in the simulator only. Not saved to the preset.">
                          <input
                            type="checkbox"
                            checked={!isHidden(hidden, i, k)}
                            disabled={hidden.has(`${i}`)}
                            onChange={() => setHidden(toggleKey(hidden, `${i}.${k}`))}
                          />
                          Show
                        </label>
                      )
                    : undefined
                }
                onRemove={
                  realCount > 1
                    ? () => {
                        setState({ ...state, seg: segments.filter((_, j) => j !== i) });
                        setGroups(removeGroupMember(groups, i, true));
                        setCollapsed(without(collapsed, i));
                        setHidden(remapSegments(hidden, (j) => (j === i ? undefined : j > i ? j - 1 : j)));
                      }
                    : undefined
                }
              />
            </div>
          );
        })}
        <Button
          onClick={() => {
            // Presets saved on a controller pad seg with clear markers up to its segment limit; as in the
            // preset editor, a new segment takes the first marker's place (and ID), or goes on the end.
            const p = segments.findIndex(isClearMarker);
            if (p >= 0) {
              const seg = [...segments];
              seg[p] = { ...newSegment(rgbw), id: segments[p]!.id ?? p };
              setState({ ...state, seg });
              setHidden(remapSegments(hidden, (j) => (j === p ? undefined : j)));
              setCollapsed(new Set([...collapsed].filter((j) => j !== p)));
              return;
            }
            const ids = new Set(segments.map((s, i) => s.id ?? i));
            let id = 0;
            while (ids.has(id)) id++;
            setState({ ...state, seg: [...segments, { ...newSegment(rgbw), id }] });
          }}
          disabled={used >= 32}
        >
          Add segment
        </Button>
      </div>
    </div>
  );
}

const PLACEMENT = new Set(["id", "start", "stop", "rev", "sid", "n"]);
const settingsOnly = (s: Segment): Segment => Object.fromEntries(Object.entries(s).filter(([k]) => !PLACEMENT.has(k)));
