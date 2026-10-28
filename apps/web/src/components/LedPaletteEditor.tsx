import { useMemo, useState } from "react";
import {
  definitionLabel,
  ledAtPosition,
  palettePosition,
  resolveSegment,
  type Controller,
  type LedRange,
  type PaletteStop,
} from "@wled-manager/shared";
import { LedMap, type SelectMods } from "./locator/LedMap";
import { GradientSwatch, sampleGradient } from "./GradientEditor";
import { Button } from "./ui";

/** "strip", or a segment definition ID. */
type SpreadOver = string;

type Run = { start: number; stop: number; rev: boolean };

/** The LEDs a palette is spread over: the whole strip or one defined segment. */
function runFor(c: Controller, over: SpreadOver): { run: Run; ledCount: number } | { error: string } {
  const ledCount = c.device?.ledCount;
  if (!ledCount) return { error: "Refresh the controller to read its LED count." };
  if (over === "strip") return { run: { start: 0, stop: ledCount, rev: false }, ledCount };
  const index = c.segments.findIndex((d) => d.id === over);
  const def = c.segments[index];
  if (!def) return { error: "That segment was deleted." };
  const r = resolveSegment(def, { markers: c.markers, ranges: c.ranges, ledCount });
  if (!r.ok) return { error: `${definitionLabel(def, index)}: ${r.error}` };
  return { run: r.segment, ledCount };
}

const SELECTED = "#ffffff";
const STOP = "#38bdf8";

interface Props {
  controllers: Controller[];
  /** Editing a controller's own version: it is shown on that controller only. */
  lockedTo?: string;
  stops: PaletteStop[];
  onChange: (stops: PaletteStop[]) => void;
  selected: number;
  onSelect: (index: number) => void;
  maxStops: number;
}

/**
 * Edits a palette on a controller's LEDs, drawn as in the locator: each LED shows the palette color it gets
 * when the palette is spread over the strip or a segment. Clicking an LED adds a stop there or selects the
 * stop on it; Shift-click moves the selected stop.
 */
export function LedPaletteEditor({ controllers, lockedTo, stops, onChange, selected, onSelect, maxStops }: Props) {
  const usable = controllers.filter((c) => c.device);
  const [chosen, setChosen] = useState<string>();
  const [over, setOver] = useState<SpreadOver>("strip");
  // The LED last clicked when the palette had no room for another stop.
  const [full, setFull] = useState<{ led: number; pos: number } | null>(null);
  const c = controllers.find((x) => x.id === (lockedTo ?? chosen)) ?? usable[0];
  const resolved = c ? runFor(c, over) : undefined;
  const ok = resolved && !("error" in resolved) ? resolved : undefined;

  // Defined segments in LED tooltips.
  const segmentRanges = useMemo<LedRange[]>(() => {
    if (!c?.device) return [];
    const ctx = { markers: c.markers, ranges: c.ranges, ledCount: c.device.ledCount };
    return c.segments.flatMap((def, i) => {
      const r = resolveSegment(def, ctx);
      return r.ok ? [{ label: definitionLabel(def, i), spans: [{ start: r.segment.start, stop: r.segment.stop }] }] : [];
    });
  }, [c]);

  const view = useMemo(() => {
    if (!ok) return undefined;
    const { run, ledCount } = ok;
    const colors: (string | undefined)[] = [];
    const notes: (string | undefined)[] = [];
    for (let i = 0; i < ledCount; i++) {
      const pos = palettePosition(i, run);
      if (pos === undefined) continue;
      colors[i] = sampleGradient(stops, pos);
      notes[i] = `palette ${pos}`;
    }
    // Each palette position covers one or more LEDs (several on strips longer than 256 LEDs), so a stop rings
    // every LED showing its position. On short runs some positions fall between LEDs; those use the nearest.
    const ledsAt = new Map<number, number[]>();
    for (let i = run.start; i < run.stop; i++) {
      const pos = palettePosition(i, run)!;
      ledsAt.set(pos, [...(ledsAt.get(pos) ?? []), i]);
    }
    const stopLeds = stops.map((s) => ledsAt.get(s.pos) ?? [ledAtPosition(s.pos, run)]);
    const outlines: (string | undefined)[] = [];
    stopLeds.forEach((leds, i) => {
      for (const led of leds) {
        if (outlines[led] !== SELECTED) outlines[led] = i === selected ? SELECTED : STOP;
        notes[led] = `${notes[led]} · stop ${i + 1}`;
      }
    });
    const ledsPerPosition = (run.stop - run.start) / 256;
    return { colors, notes, outlines, stopLeds, ledsAt, ledsPerPosition };
  }, [ok, stops, selected]);

  if (!c) return <p className="text-sm text-neutral-500">Add a controller and refresh it to edit the palette on its LEDs.</p>;

  const onLed = (led: number, mods: SelectMods) => {
    if (!ok || !view) return;
    const pos = palettePosition(led, ok.run);
    if (pos === undefined) return;
    if (mods.range) {
      setFull(null);
      onChange(stops.map((s, i) => (i === selected ? { ...s, pos } : s)));
      return;
    }
    setFull(null);
    const here = view.stopLeds.flatMap((leds, i) => (leds.includes(led) ? [i] : []));
    if (here.length) {
      // Several stops can share an LED on short runs; clicking again steps through them.
      onSelect(here[(here.indexOf(selected) + 1) % here.length]!);
    } else if (stops.length < maxStops) {
      onChange([...stops, { pos, color: sampleGradient(stops, pos) }]);
      onSelect(stops.length);
    } else {
      // No room for another stop: pick the nearest one, and offer to move it here.
      const nearest = stops.reduce((best, s, i) => (Math.abs(s.pos - pos) < Math.abs(stops[best]!.pos - pos) ? i : best), 0);
      onSelect(nearest);
      setFull({ led, pos });
    }
  };

  const moveHere = () => {
    if (!full) return;
    onChange(stops.map((s, i) => (i === selected ? { ...s, pos: full.pos } : s)));
    setFull(null);
  };

  /** Moves the selected stop to the next palette position along the run that shows on an LED. */
  const nudge = (step: number) => {
    if (!ok || !view) return;
    setFull(null);
    const positions = [...view.ledsAt.keys()].sort((a, b) => a - b);
    const current = stops[selected]!.pos;
    // Positions run with the LEDs, or against them on a reversed run.
    const forward = ok.run.rev ? -step : step;
    const next = forward > 0 ? positions.find((p) => p > current) : positions.findLast((p) => p < current);
    if (next !== undefined) onChange(stops.map((s, i) => (i === selected ? { ...s, pos: next } : s)));
  };

  const select = "rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-400">LEDs of</span>
        {lockedTo ? (
          <span>{c.name}</span>
        ) : (
          <select
            value={c.id}
            onChange={(e) => {
              setChosen(e.target.value);
              setOver("strip");
            }}
            className={select}
          >
            {usable.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        )}
        <span className="text-neutral-400">with the palette across</span>
        <select value={over} onChange={(e) => setOver(e.target.value)} className={select}>
          <option value="strip">the whole strip</option>
          {c.segments.map((d, i) => (
            <option key={d.id} value={d.id}>{definitionLabel(d, i)}</option>
          ))}
        </select>
      </div>
      {resolved && "error" in resolved && <p className="text-sm text-amber-400">{resolved.error}</p>}
      {ok && view && (
        <>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
            <LedMap
              count={ok.ledCount}
              layout={c.layout}
              markers={c.markers}
              ranges={[...c.ranges, ...segmentRanges]}
              current={null}
              color={SELECTED}
              colors={view.colors}
              outlines={view.outlines}
              notes={view.notes}
              onSelect={onLed}
            />
          </div>
          <GradientSwatch stops={stops} className="h-3" />
          {full && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              <span>
                All {maxStops} stops are in use, so LED {full.led} selected the nearest one (stop {selected + 1}).
              </span>
              <Button onClick={moveHere}>Move stop {selected + 1} to LED {full.led}</Button>
              <span className="text-xs text-amber-300/80">or remove a stop to add one here.</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span>
              Click an LED to add a stop ({stops.length}/{maxStops}) or select its stop; Shift-click moves the selected
              stop there.{" "}
              {view.ledsPerPosition > 1 &&
                `A palette has 256 positions, so here each covers about ${view.ledsPerPosition.toFixed(1)} LEDs; a stop rings all of them. `}
              <span title={'Colors as effects that spread the palette along the segment, such as "Palette", show them. Grouping and spacing in a preset stretch it further.'} className="cursor-help underline decoration-dotted">
                About these colors
              </span>
            </span>
            <span className="ml-auto flex shrink-0 gap-1">
              <Button onClick={() => nudge(-1)} title="Move the selected stop back">◀</Button>
              <Button onClick={() => nudge(1)} title="Move the selected stop on">▶</Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
