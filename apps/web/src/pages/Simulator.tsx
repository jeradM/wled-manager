import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  applyGroupEdit,
  duplicateSegment,
  removeGroupMember,
  renumberSegments,
  type Palette,
  type PresetInput,
  type PresetState,
  type Segment,
  type SegmentGroup,
} from "@wled-manager/shared";
import { SIM_EFFECTS, Simulator as Sim, ledCss, simCatalog, stopsToPalette16, type LedTrace, type Palette16 } from "@wled-manager/shared/sim";
import { BLEND_MODES } from "../components/preset/wled-options";
import { usePalettes, usePresets, useWritePreset } from "../queries";
import { SegmentEditor } from "../components/preset/SegmentEditor";
import { isClearMarker, newSegment } from "../components/preset/describe";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

const CATALOG = simCatalog();
const COUNT_KEY = "simLedCount";
const RGBW_KEY = "simRgbw";
const MAX_LEDS = 2000;
const scratchState = (): PresetState => ({ on: true, bri: 128, seg: [{ id: 0, fx: 0, col: [[255, 170, 0]], pal: 0 }] });
const savedLedCount = () => {
  const n = Number(localStorage.getItem(COUNT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= MAX_LEDS ? n : 60;
};

const segmentName = (s: Segment, i: number) => (typeof s.n === "string" && s.n ? s.n : `Segment ${s.id ?? i}`);

/** The segment's effect in the simulator: matched by the name saved with the preset, else by ID. */
function simEffect(s: Segment): number | undefined {
  const byName = s.fxName ? CATALOG.effects.indexOf(s.fxName) : -1;
  return byName >= 0 ? byName : s.fx;
}

/** Runs WLED effects in the browser on a strip of simulated LEDs, independent of any controller. */
export function Simulator() {
  const { preset: presetId } = useSearch({ from: "/simulator" });
  const navigate = useNavigate();
  const { data: presets = [] } = usePresets();
  const { data: palettes = [] } = usePalettes();
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
  const snapshot = (st: PresetState, gs: SegmentGroup[] | undefined) => JSON.stringify({ state: st, groups: gs ?? [] });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // By position in state.seg. Simulator only: neither is saved with the preset.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const toggleIn = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (!next.delete(i)) next.add(i);
    return next;
  };
  /** Positions after removing the segment at `i`. */
  const without = (set: Set<number>, i: number) => new Set([...set].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)));
  const simState = useMemo(
    () => (hidden.size ? { ...state, seg: state.seg.map((s, i) => (hidden.has(i) ? { ...s, on: false } : s)) } : state),
    [state, hidden],
  );

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
    let seg = [...state.seg];
    let presetGroups = groups;
    // As in the preset editor: with clear markers present, a removed segment becomes one, keeping positions (IDs).
    const markers = seg.some(isClearMarker);
    for (const i of [...hidden].sort((a, b) => b - a)) {
      if (i >= seg.length) continue;
      if (markers) seg[i] = { id: seg[i]!.id ?? i, stop: 0 };
      else seg = seg.filter((_, j) => j !== i);
      presetGroups = removeGroupMember(presetGroups, i, !markers);
    }
    const next = markers ? { ...state, seg } : renumberSegments({ ...state, seg });
    return { state: next, groups: presetGroups.filter((g) => g.members.length > 0) };
  };
  const kept = state.seg.filter((s, i) => !isClearMarker(s) && !hidden.has(i)).length;
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
    setState({ ...state, seg });
  };
  const real = segments.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const realCount = real.length;
  /** Adds a copy of segment `i` right below it, in its group. Real segments move ahead of clear markers. */
  const copySegment = (i: number) => {
    const copied = duplicateSegment(state, groups, i);
    const at = real.indexOf(i);
    const moved = (set: Set<number>) => new Set([...set].flatMap((p) => (real.includes(p) ? [real.indexOf(p) + (real.indexOf(p) > at ? 1 : 0)] : [])));
    setState(copied.state);
    setGroups(copied.groups);
    setHidden(moved(hidden));
    setCollapsed(moved(collapsed));
  };
  const rgbw = rgbwChoice ?? segments.some((s) => s.col?.some((c) => Array.isArray(c) && c.length === 4));
  const statePresets = presets.filter((p) => p.kind === "state").sort((a, b) => a.slot - b.slot);
  const unsimulated = segments.flatMap((s, i) => {
    const fx = simEffect(s);
    return isClearMarker(s) || fx === undefined || SIM_EFFECTS.has(fx) ? [] : [`${segmentName(s, i)}: ${s.fxName ?? `effect ${fx}`}`];
  });
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
              onClick={() => setCreating({ name: loaded ? `${loaded.name} copy` : "", slot: freeSlot() })}
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
                  {hidden.size > 0 && `, leaving out ${hidden.size} hidden in the simulator`}.
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
        <LedCanvas state={simState} count={count} palettes={palettes} paused={paused} whiteLeds={rgbw} hidden={hidden} />
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
              <input type="checkbox" checked={!hidden.has(i)} onChange={() => setHidden(toggleIn(hidden, i))} />
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
            const fx = simEffect(s);
            const fxName = (fx !== undefined && CATALOG.effects[fx]) || s.fxName || (fx === undefined ? "(unchanged)" : `Effect ${fx}`);
            return (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm ${hidden.has(i) ? "opacity-50" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {chevron}
                  <span className="font-medium">{title}</span>
                  <span className="truncate text-xs text-neutral-400">
                    {fxName} · LEDs {s.start ?? 0}–{(s.stop ?? count) - 1}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  {showToggle}
                  {realCount < 32 && (
                    <button type="button" onClick={() => copySegment(i)} className="text-sky-400 hover:text-sky-300" title="Add a copy of this segment right below it">
                      Copy
                    </button>
                  )}
                </span>
              </div>
            );
          }
          return (
            <div key={i} className={hidden.has(i) ? "opacity-60" : undefined}>
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
                onCopy={realCount < 32 ? () => copySegment(i) : undefined}
                onRemove={
                  realCount > 1
                    ? () => {
                        setState({ ...state, seg: segments.filter((_, j) => j !== i) });
                        setGroups(removeGroupMember(groups, i, true));
                        setCollapsed(without(collapsed, i));
                        setHidden(without(hidden, i));
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
              setHidden(new Set([...hidden].filter((j) => j !== p)));
              setCollapsed(new Set([...collapsed].filter((j) => j !== p)));
              return;
            }
            const ids = new Set(segments.map((s, i) => s.id ?? i));
            let id = 0;
            while (ids.has(id)) id++;
            setState({ ...state, seg: [...segments, { ...newSegment(rgbw), id }] });
          }}
          disabled={realCount >= 32}
        >
          Add segment
        </Button>
      </div>
    </div>
  );
}

const PLACEMENT = new Set(["id", "start", "stop", "rev", "sid", "n"]);
const settingsOnly = (s: Segment): Segment => Object.fromEntries(Object.entries(s).filter(([k]) => !PLACEMENT.has(k)));

/** The simulated strip: LEDs as circles, wrapped into rows, animated at WLED's frame rate. While paused, clicking an LED explains its color. */
function LedCanvas({
  state,
  count,
  palettes,
  paused,
  whiteLeds,
  hidden,
}: {
  state: PresetState;
  count: number;
  palettes: Palette[];
  paused: boolean;
  whiteLeds: boolean;
  /** Segment positions turned off in the simulator only. */
  hidden: Set<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sim = useMemo(() => new Sim(count), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ led: number; x: number; y: number } | null>(null);
  const pickedLed = useRef<number | null>(null);
  pickedLed.current = picked?.led ?? null;

  const resolved = useMemo(() => {
    const m = new Map<string, Palette16>();
    for (const p of palettes) m.set(p.id, stopsToPalette16(p.stops));
    return m;
  }, [palettes]);

  useEffect(() => {
    sim.setPaused(paused);
    if (!paused) setPicked(null);
  }, [sim, paused]);

  // Bumped after each apply so the details recompute against the current settings.
  const [applied, setApplied] = useState(0);
  useEffect(() => {
    sim.setLength(count);
    const seg = state.seg.map((s) => {
      const fx = simEffect(s);
      return fx === s.fx ? s : { ...s, fx };
    });
    sim.apply({ ...state, seg }, (id) => resolved.get(id) ?? null);
    setApplied((n) => n + 1);
  }, [sim, state, count, resolved]);

  useEffect(() => {
    if (picked && picked.led >= count) setPicked(null);
  }, [picked, count]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pitch between LED centers: as large as fits on one row, between 10 and 28 px, wrapping into rows.
  const pitch = Math.max(10, Math.min(28, width / count));
  const cols = Math.max(1, Math.floor(width / pitch));
  const rows = Math.ceil(count / cols);
  const height = Math.ceil(rows * pitch);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    let raf = 0;
    const draw = (now: number) => {
      const px = sim.frame(now);
      const on = state.on !== false;
      const bri = state.bri ?? 128;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, width, height);
      const r = pitch * 0.36;
      for (let i = 0; i < count; i++) {
        const x = (i % cols) * pitch + pitch / 2;
        const y = Math.floor(i / cols) * pitch + pitch / 2;
        const c = on ? px[i]! : 0;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = c ? ledCss(c, bri, whiteLeds) : "#1c1c1c";
        ctx.fill();
        if (i === pickedLed.current) {
          ctx.beginPath();
          ctx.arc(x, y, pitch * 0.48, 0, Math.PI * 2);
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim, width, height, pitch, cols, count, state.on, state.bri, whiteLeds]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!paused) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / pitch);
    const led = Math.floor(y / pitch) * cols + col;
    setPicked(col < cols && led < count && led !== picked?.led ? { led, x, y: (Math.floor(y / pitch) + 1) * pitch } : null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => (picked ? sim.explain(picked.led) : null), [sim, picked, applied]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        onClick={pick}
        style={{ width: "100%", height }}
        className={`block rounded-md ${paused ? "cursor-pointer" : ""}`}
        title={paused ? "Click an LED to see how its color is made" : undefined}
      />
      {paused && !picked && <p className="mt-1 text-xs text-neutral-500">Paused. Click an LED to see how its color is made.</p>}
      {picked && trace && (
        <div className="absolute z-40 mt-1" style={{ top: picked.y, left: Math.max(0, Math.min(picked.x - 24, width - 384)) }}>
          <LedDetails
            trace={trace}
            state={state}
            palettes={palettes}
            whiteLeds={whiteLeds}
            hidden={hidden}
            onClose={() => setPicked(null)}
          />
        </div>
      )}
    </div>
  );
}

const colorText = (c: number, whiteLeds: boolean) => {
  const hex = "#" + (c & 0xffffff).toString(16).padStart(6, "0");
  return whiteLeds && c >>> 24 ? `${hex} W${c >>> 24}` : hex;
};

function Chip({ color, whiteLeds, label }: { color: number; whiteLeds: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={label}>
      <span className="inline-block size-3.5 rounded-full border border-neutral-600" style={{ background: ledCss(color, 255, whiteLeds) }} />
      <span className="font-mono text-[11px] text-neutral-300">{colorText(color, whiteLeds)}</span>
    </span>
  );
}

/** Every segment on an LED, bottom to top, and how each one's color combined with what was below. */
function LedDetails({
  trace,
  state,
  palettes,
  whiteLeds,
  hidden,
  onClose,
}: {
  trace: LedTrace;
  state: PresetState;
  palettes: Palette[];
  whiteLeds: boolean;
  hidden: Set<number>;
  onClose: () => void;
}) {
  const paletteName = (s: Segment) => {
    if (s.pal === undefined) return "effect's default palette";
    if (typeof s.pal === "object") return palettes.find((p) => p.id === (s.pal as { paletteId: string }).paletteId)?.name ?? "deleted palette";
    return CATALOG.palettes[s.pal] ?? `palette ${s.pal}`;
  };
  const effectName = (s: Segment) => {
    const fx = simEffect(s);
    return (fx !== undefined && CATALOG.effects[fx]) || s.fxName || "Solid";
  };
  const on = state.on !== false;
  const bri = state.bri ?? 128;

  return (
    <div className="w-96 space-y-2 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs shadow-xl shadow-black/70">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          LED {trace.led}
          <Chip color={trace.color} whiteLeds={whiteLeds} />
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-neutral-100">
          ✕
        </button>
      </div>

      {trace.layers.length === 0 && <p className="text-neutral-400">No segment covers this LED, so it stays off.</p>}
      {trace.layers.length > 0 && <p className="text-neutral-500">Segments are blended bottom to top, starting from black.</p>}

      <ol className="space-y-2">
        {trace.layers.map((layer, n) => {
          const seg = state.seg[layer.segment]!;
          const pct = Math.round(((seg.bri ?? 255) / 255) * 100);
          return (
            <li key={n} className="rounded-md border border-neutral-800 p-2">
              <div className="mb-1 font-medium text-neutral-200">
                {segmentName(seg, layer.segment)}
                <span className="font-normal text-neutral-400">
                  {" "}
                  · {effectName(seg)} · {paletteName(seg)}
                </span>
              </div>
              {layer.status === "off" && (
                <p className="text-neutral-500">Off{hidden.has(layer.segment) ? " (hidden in the simulator)" : ""}, so it adds nothing.</p>
              )}
              {layer.status === "gap" && (
                <p className="text-neutral-500">This LED is in the segment's spacing gap, so the segment leaves it alone.</p>
              )}
              {layer.writes.map((w, k) => (
                <div key={k} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                    Effect drew pixel {w.pixel}: <Chip color={w.color} whiteLeds={whiteLeds} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                    <span className="text-neutral-200">{BLEND_MODES[w.mode] ?? `Mode ${w.mode}`}</span>
                    <Chip color={w.below} whiteLeds={whiteLeds} label="Below" />
                    <span>with</span>
                    <Chip color={w.color} whiteLeds={whiteLeds} label="This segment" />
                    <span>→</span>
                    <Chip color={w.blended} whiteLeds={whiteLeds} label="Blended" />
                  </div>
                  {w.opacity < 255 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-neutral-400">
                      Opacity {pct}%: mixed with below → <Chip color={w.result} whiteLeds={whiteLeds} />
                    </div>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-800 pt-2 text-neutral-400">
        {on ? (
          <>
            Brightness {bri} → shown as
            <span className="inline-block size-3.5 rounded-full border border-neutral-600" style={{ background: ledCss(trace.color, bri, whiteLeds) }} />
          </>
        ) : (
          "The light is turned off, so the LED is dark."
        )}
      </div>
      <Link to="/simulator/blend-modes" className="block text-sky-400 hover:text-sky-300">
        How blend modes work
      </Link>
    </div>
  );
}
