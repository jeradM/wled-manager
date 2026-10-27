import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  isRangeEntry,
  resolveSegment,
  type Controller,
  type LedRange,
  type Preset,
  type ResolvedSegment,
  type Segment,
  type SegmentDefinition,
} from "@wled-manager/shared";
import { useController, usePresets, usePresetTest, useUpdateController } from "../queries";
import { LedMap } from "../components/locator/LedMap";
import { Button, Card, ErrorText, PageHeader } from "../components/ui";

/** Distinct colors for telling segments apart, on the map and in the controller preview. */
const SEGMENT_COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#d946ef", "#06b6d4", "#f97316", "#a3e635"];
const segmentColor = (i: number) => SEGMENT_COLORS[i % SEGMENT_COLORS.length]!;

/** IDs presets use to refer to a definition. crypto.randomUUID needs HTTPS, which a LAN install may not have. */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/** How many presets use each definition, by ID. */
const usageCounts = (presets: Preset[]) => {
  const counts = new Map<string, number>();
  for (const p of presets) {
    const sids = new Set(p.state?.seg.flatMap((s) => (s.sid ? [s.sid] : [])));
    for (const sid of sids) counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  return counts;
};
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
  const { data: presets = [] } = usePresets();
  const usage = useMemo(() => usageCounts(presets), [presets]);
  // Edited locally and saved shortly after each change; server refreshes don't overwrite edits in progress.
  const [defs, setDefsState] = useState<SegmentDefinition[]>(c.segments);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setDefs = (next: SegmentDefinition[]) => {
    setDefsState(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => update.mutate({ segments: next }), 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const { markers, ranges } = c;
  const count = c.device?.ledCount ?? 0;
  const resolved = useMemo(
    () => defs.map((e) => resolveSegment(e, { markers, ranges, ledCount: count })),
    [defs, markers, ranges, count],
  );
  const segments = resolved.map((r) => (r.ok ? r.segment : undefined));

  const colors = useMemo(() => {
    const out: (string | undefined)[] = [];
    segments.forEach((s, i) => {
      if (!s) return;
      for (let led = s.start; led < s.stop; led++) out[led] = segmentColor(i);
    });
    return out;
  }, [segments]);

  const setEntry = (i: number, next: SegmentDefinition) => setDefs(defs.map((e, j) => (j === i ? next : e)));
  const move = (i: number, delta: number) => {
    const next = [...defs];
    const [entry] = next.splice(i, 1);
    next.splice(i + delta, 0, entry!);
    setDefs(next);
  };
  const remove = (i: number) => {
    const used = usage.get(defs[i]!.id);
    if (used && !confirm(`${used} preset${used === 1 ? " uses" : "s use"} this segment. They'll keep its current LEDs, unlinked. Remove it?`))
      return;
    setDefs(defs.filter((_, j) => j !== i));
  };
  const add = () => {
    // Continue just past where the last segment ended (as a marker if one is there), towards the next marker.
    const prev = segments.at(-1);
    const startLed = prev ? (prev.rev ? prev.start - 1 : prev.stop) : (markers[0]?.index ?? 0);
    const at = Math.min(Math.max(0, startLed), count - 1);
    const next = markers.find((m) => m.index > at);
    setDefs([
      ...defs,
      {
        id: newId(),
        start: markers.find((m) => m.index === at)?.label ?? at,
        end: next ? { type: "marker", label: next.label, includeEnd: false } : { type: "led", index: count - 1, includeEnd: true },
      },
    ]);
  };
  // A range with several runs becomes one segment per run, named after the range.
  const addRange = (r: LedRange) =>
    setDefs([
      ...defs,
      ...r.spans.map((_, span) => ({
        id: newId(),
        name: (r.spans.length > 1 ? `${r.label} ${span + 1}` : r.label).slice(0, 32),
        range: r.label,
        span,
        reverse: false,
      })),
    ]);

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
                <h2 className="font-medium">Defined segments</h2>
                <span className="text-xs text-neutral-500">
                  {update.isPending ? "Saving…" : update.isError ? "" : "Saved for this controller"}
                </span>
              </div>
              <ErrorText error={update.error} />
              {defs.length === 0 && (
                <p className="text-sm text-neutral-500">
                  Define the parts of the strip you want to light separately, then pick them in presets.
                </p>
              )}
              <ol className="flex flex-col gap-2">
                {defs.map((entry, i) => (
                  <SegmentRow
                    key={entry.id}
                    index={i}
                    entry={entry}
                    resolution={resolved[i]!}
                    usedBy={usage.get(entry.id) ?? 0}
                    c={c}
                    first={i === 0}
                    last={i === defs.length - 1}
                    onChange={(next) => setEntry(i, next)}
                    onMove={(d) => move(i, d)}
                    onRemove={() => remove(i)}
                  />
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                {ranges.map((r) => (
                  <Button key={r.label} onClick={() => addRange(r)} title={`LEDs ${r.spans.map(describeSpan).join(", ")}`}>
                    + {r.label}
                    {r.spans.length > 1 && <span className="ml-1 text-xs text-neutral-400">({r.spans.length} parts)</span>}
                  </Button>
                ))}
                <Button onClick={add}>{ranges.length ? "+ Custom segment" : "Add segment"}</Button>
              </div>
              {ranges.length === 0 && (
                <p className="text-xs text-neutral-500">
                  Select and name ranges of LEDs with{" "}
                  <Link to="/controllers/$id/locate" params={{ id: c.id }} className="text-sky-400 hover:underline">Locate LEDs</Link>{" "}
                  to add them here in one click.
                </p>
              )}
            </Card>

            <SidePanel c={c} segments={segments} />
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
  usedBy,
  c,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  entry: SegmentDefinition;
  resolution: ReturnType<typeof resolveSegment>;
  usedBy: number;
  c: Controller;
  first: boolean;
  last: boolean;
  onChange: (next: SegmentDefinition) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { markers, ranges } = c;
  const count = c.device?.ledCount ?? 0;
  const r = resolution.ok ? resolution.segment : undefined;
  const { id, name } = entry;
  const layout = { id, ...(name ? { name } : {}) };
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
        <span className="w-6 text-neutral-500 tabular-nums">{index + 1}</span>
        <input
          value={name ?? ""}
          onChange={(e) => onChange({ ...entry, name: e.target.value || undefined })}
          placeholder={`Segment ${index + 1}`}
          aria-label="Name"
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
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↑</button>
          <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30">↓</button>
          <button type="button" aria-label="Remove segment" onClick={onRemove} className="px-1 text-neutral-500 hover:text-red-400">×</button>
        </div>
      </div>

      {point && pointEnd && (
        <div className="mt-2 pl-11 text-xs">
          <label className="flex w-fit items-center gap-1 text-neutral-400" title="Also light the end LED">
            <input
              type="checkbox"
              checked={pointEnd.includeEnd}
              onChange={(e) => onChange({ ...point, end: { ...pointEnd, includeEnd: e.target.checked } })}
            />
            Include end LED
          </label>
        </div>
      )}

      <div className="mt-1 pl-11 text-xs">
        {r ? (
          <span className="text-neutral-500">
            LEDs {describeSpan(r)} · {plural(r.stop - r.start, "LED")}
            {r.rev && " · runs backwards"}
          </span>
        ) : (
          <span className="text-red-400">{!resolution.ok && resolution.error}</span>
        )}
        <span className="text-neutral-500">{usedBy > 0 ? ` · used by ${plural(usedBy, "preset")}` : " · not in any preset yet"}</span>
      </div>
    </li>
  );
}

type PointEntry = Exclude<SegmentDefinition, { range: string }>;

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
  onChange: (next: SegmentDefinition) => void;
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

function SidePanel({ c, segments }: { c: Controller; segments: (ResolvedSegment | undefined)[] }) {
  const test = usePresetTest();
  const valid = segments.filter((s): s is ResolvedSegment => !!s);

  // Lights each segment in its map color so the layout can be checked on the strip itself.
  const preview = () => {
    const seg: Segment[] = segments.flatMap((s, i) =>
      s
        ? [{ start: s.start, stop: s.stop, rev: s.rev, grp: 1, spc: 0, of: 0, on: true, bri: 255, fx: 0, col: [segmentColor(i).slice(1)] }]
        : [],
    );
    // WLED takes hex colors; the white channel stays off. Unused segment slots are turned off.
    seg.forEach((x, id) => (x.id = id));
    for (let id = seg.length; id < (c.device?.maxSegments ?? 0); id++) seg.push({ id, stop: 0 });
    test.mutate({ controllerId: c.id, preset: { slot: 1, name: "Segment preview", kind: "state", state: { on: true, bri: 128, seg } } });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex h-fit flex-col gap-2 text-sm">
        <h2 className="font-medium">Using segments</h2>
        <p className="text-xs text-neutral-400">
          In a preset, add the segments you want and set each one's effect, colors, grouping, spacing and offset. Presets
          follow changes made here: move a marker or range and the next sync updates every preset using it.
        </p>
        <p className="text-xs text-neutral-500">
          Presets go to every controller. On another controller, a segment is matched by name, so define a segment with the
          same name there to place it on that strip.
        </p>
        <Link to="/presets/new"><Button className="w-full">New preset</Button></Link>
      </Card>

      <Card className="flex h-fit flex-col gap-3 text-sm">
        <h2 className="font-medium">Check on the lights</h2>
        <Button onClick={preview} disabled={!valid.length || valid.length > (c.device?.maxSegments ?? 32) || test.isPending || c.status !== "online"}>
          {test.isPending ? "Sending…" : "Preview on controller"}
        </Button>
        <p className="text-xs text-neutral-500">
          Lights every segment in its color on {c.name} now, without saving anything there. Load a preset to go back.
        </p>
        <ErrorText error={test.error} />
      </Card>
    </div>
  );
}
