import { useMemo, useState } from "react";
import { patternLength, patternProblem, patternSegments, type Palette, type PatternRun, type Segment, type WledColor } from "@wled-manager/shared";
import { LedCanvas } from "../sim/LedCanvas";
import { Button, Card } from "../ui";
import { ColorField } from "./ColorField";
import { colorCss } from "./color";

/** LEDs a pattern can be laid over: an existing segment's, say. */
export type PatternSpan = { label: string; start: number; stop: number };

const solid = (rgb: [number, number, number], rgbw: boolean): WledColor => (rgbw ? [...rgb, 0] : rgb);

/**
 * Builds a repeating pattern from one repeat (runs of colored or dark LEDs) and adds it as segments: one
 * per colored run, with grouping and spacing doing the repeating. Previews the result over the chosen LEDs.
 */
export function PatternBuilder({
  rgbw,
  palettes,
  ledCount,
  spans,
  room,
  onAdd,
  onCancel,
}: {
  rgbw: boolean;
  palettes: Palette[];
  /** The strip's length, when known: the default LEDs to cover. */
  ledCount: number | undefined;
  spans: PatternSpan[];
  /** WLED segments still free. */
  room: number;
  onAdd: (segments: Segment[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("Pattern");
  const [start, setStart] = useState(0);
  const [stop, setStop] = useState(ledCount ?? 60);
  const [runs, setRuns] = useState<PatternRun[]>(() => [
    { count: 3, color: solid([255, 0, 0], rgbw) },
    { count: 3, color: solid([0, 255, 0], rgbw) },
  ]);

  const problem = patternProblem(runs, start, stop);
  const segments = useMemo(() => patternSegments(runs, start, stop, name.trim() || "Pattern"), [runs, start, stop, name]);
  const length = patternLength(runs);
  const tooMany = segments.length > room;
  const coloredRuns = runs.filter((r) => r.color && r.count > 0).length;
  const blackPaint = segments.some((s) => Array.isArray(s.col?.[0]) && (s.col[0] as number[]).every((v) => v === 0));
  // The pattern on its own LEDs, for the preview.
  const preview = useMemo(
    () => ({ on: true, bri: 200, seg: segments.map((s, id) => ({ ...s, id, start: s.start! - start, stop: s.stop! - start })) }),
    [segments, start],
  );

  const setRun = (i: number, patch: Partial<PatternRun>) => setRuns(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRun = (i: number, d: -1 | 1) => {
    const next = [...runs];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setRuns(next);
  };
  const covered = stop - start;
  const repeats = length > 0 ? Math.floor(covered / length) : 0;

  return (
    <Card className="space-y-4 border-sky-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Add a pattern</h2>
          <p className="text-xs text-neutral-500">
            Set up one repeat; it's repeated over the LEDs below using grouping and spacing, with segments overlapping where that
            takes fewer of them (later segments draw on top).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Name</span>
          <input
            value={name}
            maxLength={28}
            onChange={(e) => setName(e.target.value)}
            className="w-40 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            aria-label="Pattern name"
          />
        </label>
        <IntField label="Start LED" value={start} min={0} max={65534} onChange={setStart} />
        <IntField label="Stop LED" value={stop} min={1} max={65535} onChange={setStop} title="The first LED past the pattern, as for segments" />
        {spans.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Use the LEDs of</span>
            <select
              value=""
              onChange={(e) => {
                const s = spans[Number(e.target.value)];
                if (s) {
                  setStart(s.start);
                  setStop(s.stop);
                }
              }}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              aria-label="Use the LEDs of"
            >
              <option value="" disabled>
                Choose…
              </option>
              {spans.map((s, i) => (
                <option key={i} value={i}>
                  {s.label} ({s.start}–{s.stop - 1})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">One repeat</h3>
        <div className="flex flex-wrap items-stretch gap-2">
          {runs.map((r, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                {r.color ? (
                  <ColorField label="Color" value={r.color} rgbw={rgbw} onChange={(c) => setRun(i, { color: c })} />
                ) : (
                  <span className="flex items-center gap-2 px-2 py-1 text-neutral-400">
                    <span className="size-4 rounded-sm border border-dashed border-neutral-600" />
                    Off
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRuns([...runs.slice(0, i + 1), structuredClone(r), ...runs.slice(i + 1)])}
                    className="text-neutral-500 hover:text-sky-400"
                    aria-label={`Copy run ${i + 1}`}
                    title="Copy: adds the same run right after this one"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuns(runs.filter((_, j) => j !== i))}
                    disabled={runs.length === 1}
                    className="text-neutral-500 hover:text-red-400 disabled:opacity-30"
                    aria-label={`Remove run ${i + 1}`}
                  >
                    ×
                  </button>
                </span>
              </div>
              <IntField label="LEDs" value={r.count} min={1} max={255} onChange={(n) => setRun(i, { count: n })} compact />
              <div className="flex items-center justify-between gap-1 text-neutral-400">
                <button type="button" onClick={() => moveRun(i, -1)} disabled={i === 0} className="px-1 hover:text-neutral-100 disabled:opacity-30" aria-label={`Move run ${i + 1} earlier`}>
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setRun(i, { color: r.color ? null : solid([255, 255, 255], rgbw) })}
                  className="hover:text-neutral-100"
                  title={r.color ? "Make these LEDs dark" : "Give these LEDs a color"}
                >
                  {r.color ? "Make off" : "Make color"}
                </button>
                <button
                  type="button"
                  onClick={() => moveRun(i, 1)}
                  disabled={i === runs.length - 1}
                  className="px-1 hover:text-neutral-100 disabled:opacity-30"
                  aria-label={`Move run ${i + 1} later`}
                >
                  →
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-col justify-center gap-1.5">
            <Button onClick={() => setRuns([...runs, { count: 3, color: solid([0, 0, 255], rgbw) }])}>+ Color</Button>
            <Button onClick={() => setRuns([...runs, { count: 1, color: null }])}>+ Gap</Button>
          </div>
        </div>
        {/* One repeat, LED by LED. */}
        {length > 0 && length <= 256 && (
          <div className="flex flex-wrap gap-0.5" aria-label="One repeat">
            {runs.flatMap((r, i) =>
              Array.from({ length: r.count }, (_, k) => (
                <span
                  key={`${i}-${k}`}
                  className={`size-3 rounded-full ${r.color ? "" : "border border-dashed border-neutral-600"}`}
                  style={r.color ? { background: colorCss(r.color) } : undefined}
                />
              )),
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Preview, LEDs {start}–{Math.max(start, stop - 1)}
        </h3>
        {!problem && covered > 0 && covered <= 2000 && <LedCanvas state={preview} count={covered} palettes={palettes} paused={false} whiteLeds={rgbw} />}
        <p className={`text-xs ${problem || tooMany ? "text-red-400" : "text-neutral-400"}`}>
          {problem ??
            (tooMany
              ? `This makes ${segments.length} segments, but only ${room} more fit in this preset.`
              : `${segments.length} segment${segments.length === 1 ? "" : "s"}${
                  segments.length < coloredRuns ? ` (overlapping, instead of ${coloredRuns})` : ""
                }; repeats every ${length} LEDs, ${repeats} time${repeats === 1 ? "" : "s"}${
                  covered % length ? " plus part of one" : ""
                }.`)}
        </p>
        {!problem && runs.some((r) => !r.color) && (
          <p className="text-xs text-neutral-500">
            {blackPaint
              ? "Some off LEDs sit inside an overlapping segment, so a black segment covers them; other off LEDs aren't in any of these segments and show whatever else covers them, or stay dark."
              : "Off LEDs aren't in any of these segments: they show whatever else covers them, or stay dark."}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onAdd(segments)} disabled={!!problem || tooMany || !segments.length}>
          Add {segments.length || ""} segment{segments.length === 1 ? "" : "s"}
        </Button>
      </div>
    </Card>
  );
}

/** A whole-number field that lets you clear and retype it, keeping the last valid number. */
function IntField({
  label,
  value,
  min,
  max,
  onChange,
  title,
  compact,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  title?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className={compact ? "flex items-center justify-between gap-2" : "flex flex-col gap-1"} title={title}>
      <span className="text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={text ?? value}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(null)}
        aria-label={label}
        className={`${compact ? "w-16 py-0.5" : "w-24 py-1"} rounded-md border border-neutral-700 bg-neutral-900 px-2`}
      />
    </label>
  );
}
