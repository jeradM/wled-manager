import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  applySegments,
  isClearMarker,
  isRangeEntry,
  litLeds,
  overlappingSegments,
  resolveSegment,
  virtualLength,
  type Controller,
  type LedRange,
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
// Select values: "r:<label>:<part>" a range part, "m:<label>" a marker, or an LED number / length.
const LENGTH = "length";
const LED = "led";
const rangeValue = (label: string, span: number) => `r:${span}:${label}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const describeSpan = (s: { start: number; stop: number }) => (s.stop - s.start > 1 ? `${s.start}–${s.stop - 1}` : `${s.start}`);

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

  const { markers, ranges } = c;
  const count = c.device?.ledCount ?? 0;
  const maxSegments = c.device?.maxSegments ?? 32;
  const resolved = useMemo(
    () => plan.map((e) => resolveSegment(e, { markers, ranges, ledCount: count })),
    [plan, markers, ranges, count],
  );
  const segments = resolved.map((r) => (r.ok ? r.segment : undefined));
  const overlaps = overlappingSegments(segments);
  const valid = plan.length > 0 && resolved.every((r) => r.ok);

  const colors = useMemo(() => {
    const out: (string | undefined)[] = [];
    // Later segments draw on top, as on the controller. LEDs left off by spacing are drawn faint.
    segments.forEach((s, i) => {
      if (!s) return;
      const color = segmentColor(i);
      for (let led = s.start; led < s.stop; led++) out[led] = `${color}40`;
      for (const led of litLeds(s)) out[led] = color;
    });
    return out;
  }, [segments]);

  const setEntry = (i: number, next: SegmentPlanEntry) => setPlan(plan.map((e, j) => (j === i ? next : e)));
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
  // A range with several runs becomes one segment per run.
  const addRange = (r: LedRange) =>
    setPlan(
      [...plan, ...r.spans.map((_, span) => ({ range: r.label, span, reverse: false }))].slice(0, maxSegments),
    );

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
            <LedMap count={count} layout={c.layout} markers={markers} ranges={ranges} current={null} color="#fff" colors={colors} />
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
              <ol className="flex flex-col gap-2">
                {plan.map((entry, i) => (
                  <SegmentRow
                    key={i}
                    index={i}
                    entry={entry}
                    resolution={resolved[i]!}
                    c={c}
                    first={i === 0}
                    last={i === plan.length - 1}
                    onChange={(next) => setEntry(i, next)}
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
              <div className="flex flex-wrap items-center gap-2">
                {ranges.map((r) => (
                  <Button
                    key={r.label}
                    onClick={() => addRange(r)}
                    disabled={plan.length >= maxSegments}
                    title={`LEDs ${r.spans.map(describeSpan).join(", ")}`}
                  >
                    + {r.label}
                    {r.spans.length > 1 && <span className="ml-1 text-xs text-neutral-400">({r.spans.length} parts)</span>}
                  </Button>
                ))}
                <Button onClick={add} disabled={plan.length >= maxSegments}>
                  {ranges.length ? "+ Custom segment" : "Add segment"}
                </Button>
              </div>
              {ranges.length === 0 && (
                <p className="text-xs text-neutral-500">
                  Select and name ranges of LEDs with{" "}
                  <Link to="/controllers/$id/locate" params={{ id: c.id }} className="text-sky-400 hover:underline">Locate LEDs</Link>{" "}
                  to add them here in one click.
                </p>
              )}
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
  c,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  entry: SegmentPlanEntry;
  resolution: ReturnType<typeof resolveSegment>;
  c: Controller;
  first: boolean;
  last: boolean;
  onChange: (next: SegmentPlanEntry) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { markers, ranges } = c;
  const count = c.device?.ledCount ?? 0;
  const r = resolution.ok ? resolution.segment : undefined;
  const { name, grp, spc, of } = entry;
  const layout = { name, grp, spc, of };
  const point = isRangeEntry(entry) ? undefined : entry;
  const pointEnd = point && point.end.type !== "length" ? point.end : undefined;

  const markerOptions = (current: string | undefined) => (
    <>
      {current !== undefined && !markers.some((m) => m.label === current) && (
        <option value={`m:${current}`}>{current} (missing)</option>
      )}
      {markers.map((m) => (
        <option key={m.index} value={`m:${m.label}`}>{m.label} · LED {m.index}</option>
      ))}
    </>
  );

  const sourceValue = isRangeEntry(entry)
    ? rangeValue(entry.range, entry.span)
    : typeof entry.start === "number"
      ? LED
      : `m:${entry.start}`;
  const missingRange = isRangeEntry(entry) && !ranges.some((x) => x.label === entry.range && x.spans[entry.span]);

  const setSource = (v: string) => {
    if (v.startsWith("r:")) {
      const [, span, ...label] = v.split(":");
      onChange({ ...layout, range: label.join(":"), span: Number(span), reverse: isRangeEntry(entry) && entry.reverse });
      return;
    }
    const start = v === LED ? (r ? (r.rev ? r.stop - 1 : r.start) : 0) : v.slice(2);
    if (isRangeEntry(entry))
      // Keep covering the same LEDs where possible.
      onChange({ ...layout, start, end: r ? { type: "led", index: r.rev ? r.start : r.stop - 1, includeEnd: true } : { type: "length", count: 10 } });
    else onChange({ ...entry, start });
  };

  return (
    <li className="rounded-lg border border-neutral-800 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: segmentColor(index) }} />
        <span className="w-6 text-neutral-500 tabular-nums">{index}</span>
        <input
          value={name ?? ""}
          onChange={(e) => onChange({ ...entry, name: e.target.value || undefined })}
          placeholder="Name (optional)"
          maxLength={32}
          className={`${select} w-32`}
        />
        <label className="flex items-center gap-1">
          <span className="text-xs text-neutral-400">From</span>
          <select value={sourceValue} onChange={(e) => setSource(e.target.value)} className={select}>
            {missingRange && <option value={sourceValue}>{entry.range} (missing)</option>}
            {ranges.length > 0 && (
              <optgroup label="Ranges (whole run)">
                {ranges.flatMap((x) =>
                  x.spans.map((sp, k) => (
                    <option key={`${x.label}:${k}`} value={rangeValue(x.label, k)}>
                      {x.label}
                      {x.spans.length > 1 ? ` (part ${k + 1})` : ""} · {describeSpan(sp)}
                    </option>
                  )),
                )}
              </optgroup>
            )}
            <optgroup label="Start at">
              {markerOptions(!isRangeEntry(entry) && typeof entry.start === "string" ? entry.start : undefined)}
              <option value={LED}>LED #</option>
            </optgroup>
          </select>
        </label>
        {isRangeEntry(entry) ? (
          <label className="flex items-center gap-1 text-xs text-neutral-400" title="Run the effect from the range's last LED">
            <input type="checkbox" checked={entry.reverse} onChange={(e) => onChange({ ...entry, reverse: e.target.checked })} />
            Reverse
          </label>
        ) : (
          <PointEnd entry={entry} r={r} count={count} markerOptions={markerOptions} onChange={onChange} />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 pl-11 text-xs">
        <LayoutField label="Grouping" title="LEDs that show the same pixel" value={grp} min={1} placeholder={1} onChange={(v) => onChange({ ...entry, grp: v })} />
        <LayoutField label="Spacing" title="LEDs left off after each group" value={spc} min={0} placeholder={0} onChange={(v) => onChange({ ...entry, spc: v })} />
        <LayoutField label="Offset" title="Shifts the effect along the segment" value={of} min={0} placeholder={0} onChange={(v) => onChange({ ...entry, of: v })} />
        {point && pointEnd && (
          <label className="flex items-center gap-1 text-neutral-400" title="Also light the end LED">
            <input
              type="checkbox"
              checked={pointEnd.includeEnd}
              onChange={(e) => onChange({ ...point, end: { ...pointEnd, includeEnd: e.target.checked } })}
            />
            Include end LED
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↑</button>
          <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↓</button>
          <button type="button" aria-label="Remove segment" onClick={onRemove} className="px-1 text-neutral-500 hover:text-red-400">×</button>
        </div>
      </div>

      <div className="mt-1 pl-11 text-xs">
        {r ? (
          <span className="text-neutral-500">
            LEDs {describeSpan(r)} · {plural(r.stop - r.start, "LED")}
            {r.rev && " · runs backwards"}
            {(r.grp > 1 || r.spc > 0) &&
              ` · ${litLeds(r).length} lit, ${plural(virtualLength(r), "pixel")} for effects`}
          </span>
        ) : (
          <span className="text-red-400">{!resolution.ok && resolution.error}</span>
        )}
      </div>
    </li>
  );
}

type PointEntry = Exclude<SegmentPlanEntry, { range: string }>;

/** The "to" controls of a segment given by a start and an end. */
function PointEnd({
  entry,
  r,
  count,
  markerOptions,
  onChange,
}: {
  entry: PointEntry;
  r: ResolvedSegment | undefined;
  count: number;
  markerOptions: (current: string | undefined) => ReactNode;
  onChange: (next: SegmentPlanEntry) => void;
}) {
  const end = entry.end;
  return (
    <>
      {typeof entry.start === "number" && (
        <LedInput value={entry.start} count={count} onChange={(start) => onChange({ ...entry, start })} label="Start LED" />
      )}
      <label className="flex items-center gap-1">
        <span className="text-xs text-neutral-400">to</span>
        <select
          value={end.type === "marker" ? `m:${end.label}` : end.type}
          onChange={(e) => {
            const v = e.target.value;
            const includeEnd = end.type === "length" || end.includeEnd;
            onChange({
              ...entry,
              end:
                v === LENGTH
                  ? { type: "length", count: r ? (r.stop - r.start) * (r.rev ? -1 : 1) : 10 }
                  : v === LED
                    ? { type: "led", index: r ? (r.rev ? r.start : r.stop - 1) : count - 1, includeEnd: true }
                    : { type: "marker", label: v.slice(2), includeEnd },
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
        <LedInput value={end.index} count={count} onChange={(index) => onChange({ ...entry, end: { ...end, index } })} label="End LED" />
      )}
      {end.type === "length" && (
        <label className="flex items-center gap-1" title="Negative counts run backwards from the start LED">
          <input
            type="number"
            value={end.count}
            onChange={(e) => onChange({ ...entry, end: { type: "length", count: Math.trunc(Number(e.target.value)) || 0 } })}
            className={`${select} w-16`}
          />
          <span className="text-xs text-neutral-400">LEDs</span>
        </label>
      )}
    </>
  );
}

/** Small number input for grouping, spacing or offset; empty means the default. */
function LayoutField({
  label,
  title,
  value,
  min,
  placeholder,
  onChange,
}: {
  label: string;
  title: string;
  value: number | undefined;
  min: number;
  placeholder: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-neutral-400" title={title}>
      {label}
      <input
        type="number"
        min={min}
        max={255}
        value={value ?? ""}
        placeholder={String(placeholder)}
        onChange={(e) =>
          onChange(e.target.value.trim() === "" ? undefined : Math.min(255, Math.max(min, Math.trunc(Number(e.target.value)) || min)))
        }
        className={`${select} w-14 text-neutral-100`}
      />
    </label>
  );
}

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
      grp: s.grp,
      spc: s.spc,
      of: s.of,
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
