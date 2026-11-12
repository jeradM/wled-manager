import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  canonicalJson,
  patternLayers,
  patternProblem,
  segmentLayers,
  type LayeredEffect,
  type LayoutStrip,
  type Palette,
  type PatternRun,
  type Preset,
} from "@wled-manager/shared";
import { useControllers, useDeleteLayeredEffect, useLayeredEffect, useLayeredEffects, usePalettes, usePresets, useWriteLayeredEffect } from "../queries";
import { IntField, RunsEditor, newPatternRuns, offNote, patternPreview, patternSummary, runsUseWhite } from "../components/preset/PatternBuilder";
import { LedCanvas } from "../components/sim/LedCanvas";
import { LayoutView } from "../components/sim/LayoutView";
import { layoutSummary, useLayoutView } from "../components/sim/ViewPicker";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

const COUNT_KEY = "patternLedCount";
const MAX_LEDS = 300;
const savedCount = () => {
  const n = Number(localStorage.getItem(COUNT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= MAX_LEDS ? n : 60;
};

/** Presets with a segment using the pattern. */
const usingPresets = (presets: Preset[], id: string) => presets.filter((p) => p.state?.seg.some((s) => segmentLayers(s).some((l) => l.effectId === id)));

const usedText = (n: number) => (n ? `used in ${n} preset${n === 1 ? "" : "s"}` : "not used in any preset");

export function Patterns() {
  const { data: effects = [], isLoading } = useLayeredEffects();
  const { data: palettes = [] } = usePalettes();
  const { data: presets = [] } = usePresets();
  const patterns = effects.filter((e) => e.pattern);
  return (
    <div>
      <PageHeader
        title="Patterns"
        actions={
          <Link to="/patterns/new">
            <Button variant="primary">New pattern</Button>
          </Link>
        }
      />
      {!isLoading && patterns.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No patterns yet. A pattern is a run of colors (and gaps) repeated along a segment, such as red, red, white, white. Sync makes
            it from overlapping segments with grouping and spacing, laid out on each controller's own LEDs. Create one here, or from "Add
            pattern…" in a preset.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {patterns.map((p) => (
            <PatternCard key={p.id} pattern={p} palettes={palettes} used={usingPresets(presets, p.id).length} />
          ))}
        </div>
      )}
    </div>
  );
}

function PatternCard({ pattern: p, palettes, used }: { pattern: LayeredEffect; palettes: Palette[]; used: number }) {
  const runs = p.pattern!.runs;
  const state = useMemo(() => patternPreview(runs, 30, 160), [runs]);
  return (
    <Link to="/patterns/$id" params={{ id: p.id }}>
      <Card className="transition-colors hover:border-neutral-600">
        <LedCanvas state={state} count={30} palettes={palettes} paused={false} whiteLeds={runsUseWhite(runs)} />
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-medium">{p.name}</span>
          <span className="shrink-0 text-xs text-neutral-500">
            {p.layers.length} segment{p.layers.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">{usedText(used)}</p>
      </Card>
    </Link>
  );
}

export function NewPattern() {
  return <PatternEditor />;
}

export function EditPattern() {
  const { id } = useParams({ from: "/patterns/$id" });
  return <PatternEditor id={id} />;
}

function PatternEditor({ id }: { id?: string }) {
  const { data: existing, error: loadError } = useLayeredEffect(id);
  const { data: palettes = [] } = usePalettes();
  const { data: presets = [] } = usePresets();
  const write = useWriteLayeredEffect();
  const del = useDeleteLayeredEffect();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [runs, setRuns] = useState<PatternRun[]>(() => newPatternRuns(false));
  const [saved, setSaved] = useState<string | null>(id ? null : canonicalJson({ name: "", runs: newPatternRuns(false) }));
  const [count, setCount] = useState(savedCount);
  const [rgbwChoice, setRgbwChoice] = useState<boolean | null>(null);

  useEffect(() => {
    if (!existing?.pattern) return;
    setName(existing.name);
    setRuns(structuredClone(existing.pattern.runs));
    setSaved(canonicalJson({ name: existing.name, runs: existing.pattern.runs }));
  }, [existing]);

  const dirty = saved !== null && canonicalJson({ name, runs }) !== saved;
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  const rgbw = rgbwChoice ?? runsUseWhite(runs);
  const problem = patternProblem(runs);
  const state = useMemo(() => patternPreview(runs, count), [runs, count]);
  const { data: controllers = [] } = useControllers();
  const [layout, viewPicker] = useLayoutView("patternView");
  // On a layout, the pattern fills every controller's lights.
  const stateForStrip = useCallback((strip: LayoutStrip) => patternPreview(runs, Math.max(1, strip.ledCount)), [runs]);
  const stripName = (sid: string | null) => (sid === null ? "Unassigned" : (controllers.find((c) => c.id === sid)?.name ?? "Removed controller"));
  const using = id ? usingPresets(presets, id) : [];

  if (loadError) return <ErrorText error={loadError} />;
  if (id && !existing) return null;
  if (existing && !existing.pattern) return <ErrorText error={new Error(`"${existing.name}" is a layered effect, not a pattern.`)} />;

  const save = () =>
    write.mutate(
      { id, input: { name: name.trim(), layers: patternLayers(runs), pattern: { runs } } },
      {
        onSuccess: (p) => {
          setSaved(canonicalJson({ name: p.name, runs: p.pattern?.runs }));
          if (!id) void navigate({ to: "/patterns/$id", params: { id: p.id } });
        },
      },
    );
  const remove = () => {
    if (!id || !confirm(`Delete "${existing?.name}"? Presets using it keep its current segments, so they still look the same, but no longer follow changes.`))
      return;
    del.mutate(id, { onSuccess: () => void navigate({ to: "/patterns" }) });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? `Edit ${existing?.name ?? "pattern"}` : "New pattern"}
        actions={
          <>
            {id && (
              <Button variant="danger" onClick={remove} disabled={del.isPending}>
                Delete
              </Button>
            )}
            <Button onClick={() => void navigate({ to: "/patterns" })}>{dirty ? "Cancel" : "Back"}</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || !dirty || !!problem || write.isPending}>
              Save
            </Button>
          </>
        }
      />
      <ErrorText error={write.error ?? del.error} />

      <Card>
        <div className="max-w-md">
          <Input label="Name" value={name} maxLength={64} autoFocus={!id} onChange={(e) => setName(e.target.value)} />
        </div>
        {id && (
          <p className="mt-2 text-xs text-neutral-400">
            {usedText(using.length)}
            {using.length > 0 && `: ${using.map((p) => p.name).join(", ")}`}
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Use it from "Add pattern…" in a preset or the simulator, or a segment's "+ Add layer…" menu. Segments using it follow changes
          made here, and controllers pick them up at the next sync.
        </p>
      </Card>

      <Card className="sticky top-0 z-30 space-y-3 shadow-lg shadow-black/60">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          {viewPicker}
          {layout && <span className="max-w-64 self-center text-xs text-neutral-400">{layoutSummary(layout, controllers) || "No lights on this layout yet"}</span>}
          <span className={layout ? "hidden" : ""}>
            <IntField
              label="Preview LEDs"
              value={count}
              min={1}
              max={MAX_LEDS}
              onChange={(n) => {
                setCount(n);
                localStorage.setItem(COUNT_KEY, String(n));
              }}
            />
          </span>
          <label className="flex items-center gap-1.5" title="RGBW strips light the white channel; RGB strips ignore it">
            <input type="checkbox" checked={rgbw} onChange={(e) => setRgbwChoice(e.target.checked)} />
            RGBW
          </label>
          <span className={`ml-auto text-xs ${problem ? "text-red-400" : "text-neutral-500"}`}>{problem ?? patternSummary(runs, layout ? undefined : count)}</span>
        </div>
        {!problem &&
          (layout ? (
            <LayoutView layout={layout} stateFor={stateForStrip} stripName={stripName} palettes={palettes} paused={false} whiteLeds={rgbw} />
          ) : (
            <LedCanvas state={state} count={count} palettes={palettes} paused={false} whiteLeds={rgbw} />
          ))}
      </Card>

      <Card className="space-y-2">
        <RunsEditor runs={runs} onChange={setRuns} rgbw={rgbw} />
        {!problem && offNote(runs) && <p className="text-xs text-neutral-500">{offNote(runs)}</p>}
      </Card>
    </div>
  );
}
