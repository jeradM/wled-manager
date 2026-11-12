import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  patternLayers,
  patternLength,
  patternProblem,
  withLayers,
  type Palette,
  type PatternRun,
  type PresetState,
  type Segment,
  type WledColor,
} from "@wled-manager/shared";
import { useLayeredEffects, useWriteLayeredEffect } from "../../queries";
import { LedCanvas } from "../sim/LedCanvas";
import { Button, Card } from "../ui";
import { ColorField } from "./ColorField";
import { colorCss } from "./color";

/** LEDs a pattern can be laid over: an existing segment's, say. */
export type PatternSpan = { label: string; start: number; stop: number };

const solid = (rgb: [number, number, number], rgbw: boolean): WledColor => (rgbw ? [...rgb, 0] : rgb);

/** A new pattern's repeat: three red, three green. */
export const newPatternRuns = (rgbw: boolean): PatternRun[] => [
  { count: 3, color: solid([255, 0, 0], rgbw) },
  { count: 3, color: solid([0, 255, 0], rgbw) },
];

/** Whether a pattern lights white LEDs. */
export const runsUseWhite = (runs: PatternRun[]) => runs.some((r) => Array.isArray(r.color) && r.color.length === 4);

/** The light state that shows a pattern on `count` LEDs. */
export const patternPreview = (runs: PatternRun[], count: number, bri = 200): PresetState => ({
  on: true,
  bri,
  seg: [withLayers({ id: 0, start: 0, stop: count }, patternLayers(runs))],
});

/** What a pattern makes: segments per repeat, and how it repeats over `covered` LEDs. */
export function patternSummary(runs: PatternRun[], covered?: number): string {
  const length = patternLength(runs);
  const made = patternLayers(runs).length;
  const colored = runs.filter((r) => r.color && r.count > 0).length;
  const segments = `${made} segment${made === 1 ? "" : "s"}${made < colored ? ` (overlapping, instead of ${colored})` : ""}`;
  if (covered === undefined) return `${segments}; repeats every ${length} LEDs.`;
  const repeats = length > 0 ? Math.floor(covered / length) : 0;
  return `${segments}; repeats every ${length} LEDs, ${repeats} time${repeats === 1 ? "" : "s"}${covered % length ? " plus part of one" : ""}.`;
}

/** Explains off LEDs in a pattern, when it has some. */
export function offNote(runs: PatternRun[]): string | null {
  if (!runs.some((r) => !r.color)) return null;
  const blackPaint = patternLayers(runs).some((l) => Array.isArray(l.col?.[0]) && (l.col[0] as number[]).every((v) => v === 0));
  return blackPaint
    ? "Some off LEDs sit inside an overlapping segment, so a black segment covers them; other off LEDs aren't in any of the pattern's segments and show whatever is below, or stay dark."
    : "Off LEDs aren't in any of the pattern's segments: they show whatever is below, or stay dark.";
}

/** Edits one repeat of a pattern: runs of colored or dark LEDs, then the repeat LED by LED. */
export function RunsEditor({ runs, onChange, rgbw }: { runs: PatternRun[]; onChange: (runs: PatternRun[]) => void; rgbw: boolean }) {
  const length = patternLength(runs);
  const setRun = (i: number, patch: Partial<PatternRun>) => onChange(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRun = (i: number, d: -1 | 1) => {
    const next = [...runs];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
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
                  onClick={() => onChange([...runs.slice(0, i + 1), structuredClone(r), ...runs.slice(i + 1)])}
                  className="text-neutral-500 hover:text-sky-400"
                  aria-label={`Copy run ${i + 1}`}
                  title="Copy: adds the same run right after this one"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={() => onChange(runs.filter((_, j) => j !== i))}
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
          <Button onClick={() => onChange([...runs, { count: 3, color: solid([0, 0, 255], rgbw) }])}>+ Color</Button>
          <Button onClick={() => onChange([...runs, { count: 1, color: null }])}>+ Gap</Button>
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
  );
}

/**
 * Adds a segment showing a repeating pattern from the library, or a new one saved there. The segment links to
 * the pattern, so editing the pattern later changes it (and every other segment using it). Previews the
 * result over the chosen LEDs.
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
  const { data: effects = [] } = useLayeredEffects();
  const patterns = effects.filter((e) => e.pattern);
  const write = useWriteLayeredEffect();
  /** The library pattern used, or "" for a new one. */
  const [chosen, setChosen] = useState("");
  const existing = patterns.find((p) => p.id === chosen);
  const [name, setName] = useState("");
  const [start, setStart] = useState(0);
  const [stop, setStop] = useState(ledCount ?? 60);
  const [newRuns, setNewRuns] = useState<PatternRun[]>(() => newPatternRuns(rgbw));
  const runs = existing?.pattern?.runs ?? newRuns;

  const problem = patternProblem(runs, start, stop);
  const made = patternLayers(runs).length;
  const tooMany = made > room;
  const covered = stop - start;
  const preview = useMemo(() => patternPreview(runs, Math.max(1, covered)), [runs, covered]);

  const add = () => {
    const segment = (id: string, n: string): Segment => ({ start, stop, n: n.slice(0, 32), effectId: id });
    if (existing) return onAdd([segment(existing.id, existing.name)]);
    const patternName = name.trim() || `Pattern ${patterns.length + 1}`;
    write.mutate(
      { input: { name: patternName, layers: patternLayers(runs), pattern: { runs } } },
      { onSuccess: (p) => onAdd([segment(p.id, p.name)]) },
    );
  };

  return (
    <Card className="space-y-4 border-sky-900">
      <div>
        <h2 className="font-medium">Add a pattern</h2>
        <p className="text-xs text-neutral-500">
          One repeat, repeated over the LEDs below using grouping and spacing. Patterns are kept in the library: edit one there and
          every segment using it follows, on each controller's own LEDs.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Pattern</span>
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            aria-label="Pattern"
          >
            <option value="">New pattern</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!existing && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Name</span>
            <input
              value={name}
              maxLength={64}
              placeholder={`Pattern ${patterns.length + 1}`}
              onChange={(e) => setName(e.target.value)}
              className="w-40 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              aria-label="Pattern name"
            />
          </label>
        )}
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

      {existing ? (
        <p className="text-xs text-neutral-400">
          <Link to="/patterns/$id" params={{ id: existing.id }} target="_blank" className="text-sky-400 hover:underline">
            Edit "{existing.name}"
          </Link>{" "}
          (opens in a new tab) to change it everywhere it's used.
        </p>
      ) : (
        <RunsEditor runs={newRuns} onChange={setNewRuns} rgbw={rgbw} />
      )}

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Preview, LEDs {start}–{Math.max(start, stop - 1)}
        </h3>
        {!problem && covered > 0 && covered <= 2000 && <LedCanvas state={preview} count={covered} palettes={palettes} paused={false} whiteLeds={rgbw} />}
        <p className={`text-xs ${problem || tooMany ? "text-red-400" : "text-neutral-400"}`}>
          {problem ?? (tooMany ? `This pattern makes ${made} segments, but only ${room} more fit in this preset.` : patternSummary(runs, covered))}
        </p>
        {!problem && offNote(runs) && <p className="text-xs text-neutral-500">{offNote(runs)}</p>}
        {write.isError && <p className="text-xs text-red-400">Couldn't save the pattern: {write.error.message}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={add} disabled={!!problem || tooMany || !made || write.isPending}>
          {existing ? "Add segment" : "Save pattern and add segment"}
        </Button>
      </div>
    </Card>
  );
}

/** A whole-number field that lets you clear and retype it, keeping the last valid number. */
export function IntField({
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
