import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { HexColorInput, HexColorPicker } from "react-colorful";
import type { PaletteStop } from "@wled-manager/shared";
import { useBuiltinPalettes, useControllers, useDeletePalette, usePalette, usePalettePreview, useSavePalette } from "../queries";
import { GradientEditor, GradientSwatch } from "../components/GradientEditor";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

// WLED reads up to 18 entries per palette file; stay under that.
const MAX_STOPS = 16;

const DEFAULT_STOPS: PaletteStop[] = [
  { pos: 0, color: "#ff0040" },
  { pos: 128, color: "#ffb000" },
  { pos: 255, color: "#2040ff" },
];

export function NewPalette() {
  return <PaletteEditor />;
}

export function EditPalette() {
  const { id } = useParams({ from: "/palettes/$id" });
  return <PaletteEditor id={id} />;
}

function PaletteEditor({ id }: { id?: string }) {
  const { data: existing, error: loadError } = usePalette(id);
  const save = useSavePalette(id);
  const del = useDeletePalette();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [stops, setStops] = useState<PaletteStop[]>(DEFAULT_STOPS);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setStops(existing.stops);
      setSelected(0);
    }
  }, [existing]);

  if (loadError) return <ErrorText error={loadError} />;
  if (id && !existing) return null;

  const stop = stops[selected] ?? stops[0]!;
  const updateStop = (patch: Partial<PaletteStop>) =>
    setStops(stops.map((s, i) => (i === selected ? { ...s, ...patch } : s)));
  const removeStop = () => {
    setStops(stops.filter((_, i) => i !== selected));
    setSelected(0);
  };

  const submit = () =>
    save.mutate(
      { name: name.trim(), stops: [...stops].sort((a, b) => a.pos - b.pos) },
      { onSuccess: () => navigate({ to: "/palettes" }) },
    );

  const remove = () => {
    if (existing && confirm(`Delete palette "${existing.name}"? Controllers lose it on their next sync.`))
      del.mutate(existing.id, { onSuccess: () => navigate({ to: "/palettes" }) });
  };

  return (
    <div>
      <PageHeader
        title={id ? `Edit ${existing?.name}` : "New palette"}
        actions={
          <>
            {id && <Button variant="danger" onClick={remove}>Delete</Button>}
            <Button onClick={() => navigate({ to: "/palettes" })}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={save.isPending || !name.trim()}>
              Save
            </Button>
          </>
        }
      />
      <ErrorText error={save.error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="mb-4 max-w-sm">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset glow" autoFocus={!id} />
          </div>
          <p className="mb-2 text-xs text-neutral-500">
            Click the bar to add a stop ({stops.length}/{MAX_STOPS}). Drag handles or use arrow keys to move them.
          </p>
          <GradientEditor stops={stops} onChange={setStops} selected={selected} onSelect={setSelected} maxStops={MAX_STOPS} />
          <div className="flex flex-wrap items-start gap-6">
            <HexColorPicker color={stop.color} onChange={(color) => updateStop({ color })} />
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Color</span>
                <HexColorInput
                  prefixed
                  color={stop.color}
                  onChange={(color) => updateStop({ color: color.toLowerCase() })}
                  className="w-28 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-neutral-400">Position (0–255)</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={stop.pos}
                  onChange={(e) => updateStop({ pos: Math.min(255, Math.max(0, Number(e.target.value) || 0)) })}
                  className="w-28 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5"
                />
              </label>
              <Button variant="danger" onClick={removeStop} disabled={stops.length <= 2}>
                Remove stop
              </Button>
            </div>
          </div>
        </Card>
        <DeviceTools stops={stops} onLoad={(s) => { setStops(s); setSelected(0); }} />
      </div>
    </div>
  );
}

/** Start from a controller's built-in palette, or preview the current stops on a controller. */
function DeviceTools({ stops, onLoad }: { stops: PaletteStop[]; onLoad: (stops: PaletteStop[]) => void }) {
  const { data: controllers = [] } = useControllers();
  const online = controllers.filter((c) => c.status === "online");
  const [controllerId, setControllerId] = useState<string>();
  const activeId = controllerId ?? online[0]?.id;
  const { data: builtins = [], isFetching } = useBuiltinPalettes(activeId);
  const preview = usePalettePreview();
  const copyable = builtins.filter((b) => b.stops);

  if (!online.length)
    return (
      <Card>
        <p className="text-sm text-neutral-400">Add an online controller to copy its built-in palettes or preview on it.</p>
      </Card>
    );

  return (
    <Card className="flex flex-col gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">Controller</span>
        <select
          value={activeId}
          onChange={(e) => setControllerId(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5"
        >
          {online.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <div>
        <div className="mb-1 text-neutral-400">Start from a built-in palette</div>
        {isFetching ? (
          <p className="text-xs text-neutral-500">Loading palettes…</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
            {copyable.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onLoad(b.stops!.slice(0, MAX_STOPS))}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-800"
              >
                <GradientSwatch stops={b.stops!} className="h-3 w-16 shrink-0" />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-800 pt-4">
        <Button onClick={() => activeId && preview.mutate({ controllerId: activeId, stops })} disabled={preview.isPending}>
          {preview.isPending ? "Sending…" : "Preview on controller"}
        </Button>
        <p className="mt-2 text-xs text-neutral-500">
          Writes a temporary palette file to the controller and switches its selected segments to it. The next sync removes it.
        </p>
        {preview.isSuccess && <p className="mt-1 text-xs text-emerald-400">Showing as palette {preview.data.deviceId}.</p>}
        <ErrorText error={preview.error} />
      </div>
    </Card>
  );
}
