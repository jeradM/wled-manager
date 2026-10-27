import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  applySegments,
  isClearMarker,
  overlappingSegments,
  resolveSegment,
  type Controller,
  type Preset,
  type PresetInput,
  type ResolvedSegment,
  type Segment,
  type SegmentPlanEntry,
} from "@wled-manager/shared";
import { useController, usePresets, usePresetTest, useUpdateController, useWritePreset } from "../queries";
import { LedMap } from "../components/locator/LedMap";
import { newSegment } from "../components/preset/describe";
import { Button, Card, ErrorText, PageHeader } from "../components/ui";

/** Distinct colors for telling segments apart, on the map and in the controller preview. */
const SEGMENT_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#d946ef", "#06b6d4", "#f97316", "#a3e635"];
const segmentColor = (i: number) => SEGMENT_COLORS[i % SEGMENT_COLORS.length]!;

const NEW_PRESET = "new";
// Select values for the non-marker choices; they can't clash with a marker label.
const LENGTH = "\u0000length";
const LED = "\u0000led";

export function SegmentBuilder() {
  const { id } = useParams({ from: "/controllers/$id/segments" });
  const { data: c } = useController(id);
  if (!c) return null;
  return <Builder key={c.id} c={c} />;
}

function Builder({ c }: { c: Controller }) {
  const update = useUpdateController(c.id);
  // Edited locally and saved shortly after each change; server refreshes don't overwrite edits in progress.
  const [plan, setPlanState] = useState<SegmentPlanEntry[]>(c.segmentPlan);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setPlan = (next: SegmentPlanEntry[]) => {
    setPlanState(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => update.mutate({ segmentPlan: next }), 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const markers = c.markers;
  const count = c.device?.ledCount ?? 0;
  const resolved = useMemo(() => plan.map((e) => resolveSegment(e, markers, count)), [plan, markers, count]);
  const segments = resolved.map((r) => (r.ok ? r.segment : undefined));
  const overlaps = overlappingSegments(segments);
  const valid = plan.length > 0 && resolved.every((r) => r.ok);

  const colors = useMemo(() => {
    const out: (string | undefined)[] = [];
    // Later segments draw on top, as on the controller.
    segments.forEach((s, i) => {
      if (s) for (let led = s.start; led < s.stop; led++) out[led] = segmentColor(i);
    });
    return out;
  }, [segments]);

  const setEntry = (i: number, patch: Partial<SegmentPlanEntry>) =>
    setPlan(plan.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, delta: number) => {
    const next = [...plan];
    const [entry] = next.splice(i, 1);
    next.splice(i + delta, 0, entry!);
    setPlan(next);
  };
  const add = () => {
    // Continue just past where the last segment ended (as a marker if one is there), towards the next marker.
    const prev = segments.at(-1);
    const startLed = prev ? (prev.rev ? prev.start - 1 : prev.stop) : (markers[0]?.index ?? 0);
    const at = Math.min(Math.max(0, startLed), count - 1);
    const next = markers.find((m) => m.index > at);
    setPlan([
      ...plan,
      {
        start: markers.find((m) => m.index === at)?.label ?? at,
        end: next ? { type: "marker", label: next.label, includeEnd: false } : { type: "led", index: count - 1, includeEnd: true },
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title={`Segments · ${c.name}`}
        actions={
          <>
            <Link to="/controllers/$id/locate" params={{ id: c.id }}><Button>Locate LEDs</Button></Link>
            <Link to="/controllers/$id" params={{ id: c.id }}><Button>Back</Button></Link>
          </>
        }
      />

      {!c.device ? (
        <Card><p className="text-sm text-neutral-400">The controller hasn't been reached yet, so its LED count is unknown.</p></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <LedMap count={count} layout={c.layout} markers={markers} current={null} color="#fff" colors={colors} />
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Segments</h2>
                <span className="text-xs text-neutral-500">
                  {update.isPending ? "Saving…" : update.isError ? "" : "Saved for this controller"}
                </span>
              </div>
              <ErrorText error={update.error} />
              {plan.length === 0 && (
                <p className="text-sm text-neutral-500">Add segments in the order they should be numbered on the controller.</p>
              )}
              {markers.length === 0 && (
                <p className="text-sm text-neutral-500">
                  Segments can start and end at LED numbers, or at positions labelled with{" "}
                  <Link to="/controllers/$id/locate" params={{ id: c.id }} className="text-sky-400 hover:underline">Locate LEDs</Link>.
                </p>
              )}
              <ol className="flex flex-col gap-2">
                {plan.map((entry, i) => (
                  <SegmentRow
                    key={i}
                    index={i}
                    entry={entry}
                    resolution={resolved[i]!}
                    markers={markers}
                    count={count}
                    first={i === 0}
                    last={i === plan.length - 1}
                    onChange={(patch) => setEntry(i, patch)}
                    onMove={(d) => move(i, d)}
                    onRemove={() => setPlan(plan.filter((_, j) => j !== i))}
                  />
                ))}
              </ol>
              {overlaps.length > 0 && (
                <p className="rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">
                  These segments share LEDs: {overlaps.map(([a, b]) => `${a} & ${b}`).join(", ")}. The controller allows
                  this; the later segment draws on top.
                </p>
              )}
              <div>
                <Button onClick={add} disabled={plan.length >= (c.device.maxSegments ?? 32)}>Add segment</Button>
              </div>
            </Card>

            <ApplyPanel c={c} segments={valid ? (segments as ResolvedSegment[]) : null} />
          </div>
        </div>
      )}
    </div>
  );
}

const select = "rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1";

function SegmentRow({
  index,
  entry,
  resolution,
  markers,
  count,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  entry: SegmentPlanEntry;
  resolution: ReturnType<typeof resolveSegment>;
  markers: Controller["markers"];
  count: number;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<SegmentPlanEntry>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const markerOptions = (current: string | undefined) => (
    <>
      {current !== undefined && !markers.some((m) => m.label === current) && (
        <option value={current}>{current} (missing)</option>
      )}
      {markers.map((m) => (
        <option key={m.index} value={m.label}>{m.label} · LED {m.index}</option>
      ))}
    </>
  );
  const end = entry.end;

  return (
    <li className="rounded-lg border border-neutral-800 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: segmentColor(index) }} />
        <span className="w-6 text-neutral-500 tabular-nums">{index}</span>
        <input
          value={entry.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
          placeholder="Name (optional)"
          maxLength={32}
          className={`${select} w-32`}
        />
        <label className="flex items-center gap-1">
          <span className="text-xs text-neutral-400">From</span>
          <select
            value={typeof entry.start === "number" ? LED : entry.start}
            onChange={(e) =>
              onChange({ start: e.target.value === LED ? (resolution.ok ? startLed(resolution.segment) : 0) : e.target.value })
            }
            className={select}
          >
            {markerOptions(typeof entry.start === "string" ? entry.start : undefined)}
            <option value={LED}>LED #</option>
          </select>
        </label>
        {typeof entry.start === "number" && (
          <LedInput value={entry.start} count={count} onChange={(start) => onChange({ start })} label="Start LED" />
        )}
        <label className="flex items-center gap-1">
          <span className="text-xs text-neutral-400">to</span>
          <select
            value={end.type === "marker" ? end.label : end.type === "led" ? LED : LENGTH}
            onChange={(e) => {
              const v = e.target.value;
              const includeEnd = end.type === "length" || end.includeEnd;
              const r = resolution.ok ? resolution.segment : undefined;
              onChange({
                end:
                  v === LENGTH
                    ? { type: "length", count: r ? (r.stop - r.start) * (r.rev ? -1 : 1) : 10 }
                    : v === LED
                      ? { type: "led", index: r ? (r.rev ? r.start : r.stop - 1) : count - 1, includeEnd: true }
                      : { type: "marker", label: v, includeEnd },
              });
            }}
            className={select}
          >
            {markerOptions(end.type === "marker" ? end.label : undefined)}
            <option value={LED}>LED #</option>
            <option value={LENGTH}>Length</option>
          </select>
        </label>
        {end.type === "led" && (
          <LedInput value={end.index} count={count} onChange={(index) => onChange({ end: { ...end, index } })} label="End LED" />
        )}
        {end.type === "length" && (
          <label className="flex items-center gap-1" title="Negative counts run backwards from the start LED">
            <input
              type="number"
              value={end.count}
              onChange={(e) => onChange({ end: { type: "length", count: Math.trunc(Number(e.target.value)) || 0 } })}
              className={`${select} w-16`}
            />
            <span className="text-xs text-neutral-400">LEDs</span>
          </label>
        )}
      </div>
      <div className="mt-1 flex items-center gap-3 pl-11 text-xs">
        {end.type !== "length" && (
          <label className="flex items-center gap-1 text-neutral-400" title="Also light the end LED">
            <input
              type="checkbox"
              checked={end.includeEnd}
              onChange={(e) => onChange({ end: { ...end, includeEnd: e.target.checked } })}
            />
            Include end LED
          </label>
        )}
        {resolution.ok ? (
          <span className="text-neutral-500">
            LEDs {resolution.segment.start}–{resolution.segment.stop - 1} · {resolution.segment.stop - resolution.segment.start} LED{resolution.segment.stop - resolution.segment.start === 1 ? "" : "s"}
            {resolution.segment.rev && " · runs backwards"}
          </span>
        ) : (
          <span className="text-red-400">{resolution.error}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↑</button>
          <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↓</button>
          <button type="button" aria-label="Remove segment" onClick={onRemove} className="px-1 text-neutral-500 hover:text-red-400">×</button>
        </div>
      </div>
    </li>
  );
}

/** The LED a resolved segment starts from (its last LED when it runs backwards). */
const startLed = (s: ResolvedSegment) => (s.rev ? s.stop - 1 : s.start);

function LedInput({ value, count, label, onChange }: { value: number; count: number; label: string; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={count - 1}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
      className={`${select} w-16`}
    />
  );
}

function ApplyPanel({ c, segments }: { c: Controller; segments: ResolvedSegment[] | null }) {
  const { data: presets = [] } = usePresets();
  const write = useWritePreset();
  const test = usePresetTest();
  const statePresets = presets.filter((p) => p.kind === "state").sort((a, b) => a.slot - b.slot);
  const [target, setTarget] = useState<string>(NEW_PRESET);
  const [name, setName] = useState("");
  const [clearOthers, setClearOthers] = useState(true);
  const [saved, setSaved] = useState<Preset>();

  const rgbw = c.device?.rgbw ?? false;
  const preset = statePresets.find((p) => p.id === target);
  const existingCount = preset ? preset.state!.seg.filter((s) => !isClearMarker(s)).length : 0;
  const clearOthersUpTo = clearOthers ? c.device?.maxSegments : undefined;

  const freeSlot = () => {
    const used = new Set(presets.map((p) => p.slot));
    for (let s = 1; s <= 250; s++) if (!used.has(s)) return s;
    return undefined;
  };

  const apply = () => {
    if (!segments) return;
    const template = newSegment(rgbw);
    let input: PresetInput;
    if (preset) {
      const { id: _, revision, updatedAt, ...rest } = preset;
      input = { ...rest, state: applySegments(rest.state!, segments, { template, clearOthersUpTo }) };
    } else {
      const slot = freeSlot();
      if (!slot) return;
      const state = applySegments({ on: true, bri: 128, transition: 7, seg: [] }, segments, { template, clearOthersUpTo });
      input = { slot, name: name.trim(), kind: "state", state };
    }
    write.mutate(
      { id: preset?.id, input },
      {
        onSuccess: (p) => {
          setSaved(p);
          setTarget(p.id);
          setName("");
        },
      },
    );
  };

  // Lights each segment in its map color so the layout can be checked on the strip itself.
  const preview = () => {
    if (!segments) return;
    const seg: Segment[] = segments.map((s, i) => ({
      id: i,
      start: s.start,
      stop: s.stop,
      rev: s.rev,
      on: true,
      bri: 255,
      fx: 0,
      // WLED takes hex colors; the white channel stays off.
      col: [segmentColor(i).slice(1)],
    }));
    for (let id = seg.length; id < (c.device?.maxSegments ?? 0); id++) seg.push({ id, stop: 0 });
    test.mutate({ controllerId: c.id, preset: { slot: 1, name: "Segment preview", kind: "state", state: { on: true, bri: 128, seg } } });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex h-fit flex-col gap-3 text-sm">
        <h2 className="font-medium">Add to a preset</h2>
        <select value={target} onChange={(e) => { setTarget(e.target.value); setSaved(undefined); }} className={select}>
          <option value={NEW_PRESET}>New preset…</option>
          {statePresets.map((p) => (
            <option key={p.id} value={p.id}>{p.slot}. {p.name}</option>
          ))}
        </select>
        {!preset && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name"
            maxLength={64}
            className={select}
          />
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={clearOthers} onChange={(e) => setClearOthers(e.target.checked)} className="mt-0.5" />
          <span>Turn off the controller's other segments when the preset loads</span>
        </label>
        <p className="text-xs text-neutral-500">
          {preset
            ? `The segments' positions are replaced. Segment N keeps the effect and colors of the preset's segment N` +
              (segments && existingCount > segments.length
                ? `; its last ${existingCount - segments.length} segment${existingCount - segments.length === 1 ? " is" : "s are"} removed.`
                : segments && segments.length > existingCount
                  ? `; new segments start as solid amber.`
                  : ".")
            : "Each segment starts as solid amber; set effects in the preset editor."}{" "}
          Presets go to every controller, with LED positions from this one.
        </p>
        <Button variant="primary" onClick={apply} disabled={!segments || write.isPending || (!preset && !name.trim())}>
          {write.isPending ? "Saving…" : preset ? "Update preset" : "Create preset"}
        </Button>
        {!segments && <p className="text-xs text-neutral-500">Fix the segments marked in red first.</p>}
        <ErrorText error={write.error} />
        {saved && (
          <p className="text-xs text-emerald-400">
            Saved to{" "}
            <Link to="/presets/$id" params={{ id: saved.id }} className="underline">{saved.name}</Link>. Sync the controllers to upload it.
          </p>
        )}
      </Card>

      <Card className="flex h-fit flex-col gap-3 text-sm">
        <h2 className="font-medium">Check on the lights</h2>
        <Button onClick={preview} disabled={!segments || test.isPending || c.status !== "online"}>
          {test.isPending ? "Sending…" : "Preview on controller"}
        </Button>
        <p className="text-xs text-neutral-500">
          Lights each segment in its color on {c.name} now, without saving anything there. Load a preset to go back.
        </p>
        <ErrorText error={test.error} />
      </Card>
    </div>
  );
}
