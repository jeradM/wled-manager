import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  canonicalJson,
  segmentLayers,
  withLayers,
  type Layer,
  type LayeredEffect,
  type LayoutStrip,
  type Palette,
  type Preset,
  type PresetState,
} from "@wled-manager/shared";
import { useControllers, useDeleteLayeredEffect, useLayeredEffect, useLayeredEffects, usePalettes, usePresets, useWriteLayeredEffect } from "../queries";
import { LayerStack, newLayer } from "../components/preset/LayerStack";
import { layerEffectName } from "../components/preset/LayerEditor";
import { CATALOG, LedCanvas } from "../components/sim/LedCanvas";
import { LayoutView } from "../components/sim/LayoutView";
import { layoutSummary, useLayoutView } from "../components/sim/ViewPicker";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

const COUNT_KEY = "effectLedCount";
const MAX_LEDS = 300;
const savedCount = () => {
  const n = Number(localStorage.getItem(COUNT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= MAX_LEDS ? n : 60;
};

/** The light state that shows a stack of layers on `count` LEDs. */
const previewState = (layers: Layer[], count: number, bri = 128): PresetState => ({
  on: true,
  bri,
  seg: [withLayers({ id: 0, start: 0, stop: count }, layers)],
});

const usesWhite = (layers: Layer[]) => layers.some((l) => l.col?.some((c) => Array.isArray(c) && c.length === 4));

/** Presets with a segment linked to the effect. */
const linkedPresets = (presets: Preset[], effectId: string) =>
  presets.filter((p) => p.state?.seg.some((s) => segmentLayers(s).some((l) => l.effectId === effectId)));

const linkedText = (n: number) => (n ? `linked from ${n} preset${n === 1 ? "" : "s"}` : "not linked from any preset");

/** "Twinkle over Breathe over Solid": the layers top first. */
const describeLayers = (layers: Layer[]) =>
  layers
    .map((l) => layerEffectName(l, CATALOG))
    .reverse()
    .join(" over ");

export function LayeredEffects() {
  const { data: effects = [], isLoading } = useLayeredEffects();
  const { data: palettes = [] } = usePalettes();
  const { data: presets = [] } = usePresets();
  return (
    <div>
      <PageHeader
        title="Layered effects"
        actions={
          <Link to="/effects/new">
            <Button variant="primary">New layered effect</Button>
          </Link>
        }
      />
      {!isLoading && effects.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No layered effects yet. A layered effect is a stack of layers (effect, colors, blend mode, opacity…) you can apply to any
            segment in a preset or the simulator. Create one here, or save a segment's layers from its "+ Add layer…" menu.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {effects.map((e) => (
            <EffectCard key={e.id} effect={e} palettes={palettes} linked={linkedPresets(presets, e.id).length} />
          ))}
        </div>
      )}
    </div>
  );
}

function EffectCard({ effect: e, palettes, linked }: { effect: LayeredEffect; palettes: Palette[]; linked: number }) {
  const state = useMemo(() => previewState(e.layers, 30, 160), [e.layers]);
  return (
    <Link to="/effects/$id" params={{ id: e.id }}>
      <Card className="transition-colors hover:border-neutral-600">
        <LedCanvas state={state} count={30} palettes={palettes} paused={false} whiteLeds={usesWhite(e.layers)} />
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="font-medium">{e.name}</span>
          <span className="shrink-0 text-xs text-neutral-500">
            {e.layers.length} layer{e.layers.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-neutral-400">{describeLayers(e.layers)}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{linkedText(linked)}</p>
      </Card>
    </Link>
  );
}

export function NewLayeredEffect() {
  return <LayeredEffectEditor />;
}

export function EditLayeredEffect() {
  const { id } = useParams({ from: "/effects/$id" });
  return <LayeredEffectEditor id={id} />;
}

function LayeredEffectEditor({ id }: { id?: string }) {
  const { data: existing, error: loadError } = useLayeredEffect(id);
  const { data: palettes = [] } = usePalettes();
  const { data: presets = [] } = usePresets();
  const write = useWriteLayeredEffect();
  const del = useDeleteLayeredEffect();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [layers, setLayers] = useState<Layer[]>(() => [newLayer(false)]);
  const [saved, setSaved] = useState<string | null>(id ? null : canonicalJson({ name: "", layers: [newLayer(false)] }));
  const [count, setCount] = useState(savedCount);
  const [paused, setPaused] = useState(false);
  const [rgbwChoice, setRgbwChoice] = useState<boolean | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setLayers(structuredClone(existing.layers));
    setSaved(canonicalJson({ name: existing.name, layers: existing.layers }));
  }, [existing]);

  const dirty = saved !== null && canonicalJson({ name, layers }) !== saved;
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  const rgbw = rgbwChoice ?? usesWhite(layers);
  const state = useMemo(() => previewState(layers, count), [layers, count]);
  const { data: controllers = [] } = useControllers();
  const [layout, viewPicker] = useLayoutView("effectView");
  // On a layout, the effect fills every controller's lights.
  const stateForStrip = useCallback((strip: LayoutStrip) => previewState(layers, Math.max(1, strip.ledCount)), [layers]);
  const stripName = (id: string | null) => (id === null ? "Unassigned" : (controllers.find((c) => c.id === id)?.name ?? "Removed controller"));

  if (loadError) return <ErrorText error={loadError} />;
  if (id && !existing) return null;

  const save = () =>
    write.mutate(
      { id, input: { name: name.trim(), layers } },
      {
        onSuccess: (e) => {
          setSaved(canonicalJson({ name: e.name, layers: e.layers }));
          if (!id) void navigate({ to: "/effects/$id", params: { id: e.id } });
        },
      },
    );
  const remove = () => {
    if (!id || !confirm(`Delete "${existing?.name}"? Presets linked to it keep a copy of its layers, so they still look the same.`)) return;
    del.mutate(id, { onSuccess: () => void navigate({ to: "/effects" }) });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? `Edit ${existing?.name ?? "layered effect"}` : "New layered effect"}
        actions={
          <>
            {id && (
              <Button variant="danger" onClick={remove} disabled={del.isPending}>
                Delete
              </Button>
            )}
            <Button onClick={() => void navigate({ to: "/effects" })}>{dirty ? "Cancel" : "Back"}</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || !dirty || write.isPending}>
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
            {linkedText(linkedPresets(presets, id).length)}
            {linkedPresets(presets, id).length > 0 && `: ${linkedPresets(presets, id).map((p) => p.name).join(", ")}`}
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Link it to a segment from the segment's "+ Add layer…" menu in a preset or the simulator. Linked segments follow changes made
          here, and controllers pick them up at the next sync.
        </p>
      </Card>

      <Card className="sticky top-0 z-30 space-y-3 shadow-lg shadow-black/60">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          {viewPicker}
          {layout && <span className="max-w-64 self-center text-xs text-neutral-400">{layoutSummary(layout, controllers) || "No lights on this layout yet"}</span>}
          <label className={`flex flex-col gap-1 ${layout ? "hidden" : ""}`}>
            <span className="text-xs text-neutral-400">Preview LEDs</span>
            <input
              type="number"
              min={1}
              max={MAX_LEDS}
              value={count}
              onChange={(e) => {
                const n = Math.min(MAX_LEDS, Math.max(1, Math.round(Number(e.target.value)) || 1));
                setCount(n);
                localStorage.setItem(COUNT_KEY, String(n));
              }}
              className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5" title="RGBW strips light the white channel; RGB strips ignore it">
            <input type="checkbox" checked={rgbw} onChange={(e) => setRgbwChoice(e.target.checked)} />
            RGBW
          </label>
          <Button onClick={() => setPaused(!paused)}>{paused ? "Play" : "Pause"}</Button>
          <span className="ml-auto text-xs text-neutral-500">{describeLayers(layers)}</span>
        </div>
        {layout ? (
          <LayoutView layout={layout} stateFor={stateForStrip} stripName={stripName} palettes={palettes} paused={paused} whiteLeds={rgbw} />
        ) : (
          <LedCanvas state={state} count={count} palettes={palettes} paused={paused} whiteLeds={rgbw} />
        )}
      </Card>

      <Card>
        <LayerStack
          layers={layers}
          onChange={setLayers}
          room={32 - layers.length}
          saveAsEffect={false}
          linkEffects={false}
          catalog={CATALOG}
          library={palettes}
          rgbw={rgbw}
        />
      </Card>
    </div>
  );
}
