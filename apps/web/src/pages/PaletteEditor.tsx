import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { HexColorInput, HexColorPicker } from "react-colorful";
import type { PaletteStop, PaletteVariant } from "@wled-manager/shared";
import { useBuiltinPalettes, useControllers, useDeletePalette, usePalette, usePalettePreview, useSavePalette } from "../queries";
import { GradientEditor, GradientSwatch } from "../components/GradientEditor";
import { LedPaletteEditor } from "../components/LedPaletteEditor";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

// WLED reads up to 18 entries per palette file; stay under that.
const MAX_STOPS = 16;

const DEFAULT_STOPS: PaletteStop[] = [
  { pos: 0, color: "#ff0040" },
  { pos: 128, color: "#ffb000" },
  { pos: 255, color: "#2040ff" },
];

type EditorView = "gradient" | "leds";
const VIEW_KEY = "paletteEditorView";

export function NewPalette() {
  return <PaletteEditor />;
}

export function EditPalette() {
  const { id } = useParams({ from: "/palettes/$id" });
  return <PaletteEditor id={id} />;
}

function PaletteEditor({ id }: { id?: string }) {
  const { data: existing, error: loadError } = usePalette(id);
  const { data: controllers = [] } = useControllers();
  const save = useSavePalette(id);
  const del = useDeletePalette();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [stops, setStops] = useState<PaletteStop[]>(DEFAULT_STOPS);
  const [variants, setVariants] = useState<PaletteVariant[]>([]);
  // The version being edited: the palette's own stops, or a controller's.
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<EditorView>(() => (localStorage.getItem(VIEW_KEY) === "leds" ? "leds" : "gradient"));
  const chooseView = (v: EditorView) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setStops(existing.stops);
      setVariants(existing.variants);
      setEditing(null);
      setSelected(0);
    }
  }, [existing]);

  if (loadError) return <ErrorText error={loadError} />;
  if (id && !existing) return null;

  const variant = variants.find((v) => v.controllerId === editing);
  const shown = variant?.stops ?? stops;
  const setShown = (next: PaletteStop[]) =>
    variant ? setVariants(variants.map((v) => (v === variant ? { ...v, stops: next } : v))) : setStops(next);
  const controllerName = (cid: string) => controllers.find((c) => c.id === cid)?.name ?? "Removed controller";

  const stop = shown[selected] ?? shown[0]!;
  const updateStop = (patch: Partial<PaletteStop>) => setShown(shown.map((s, i) => (i === selected ? { ...s, ...patch } : s)));
  const removeStop = () => {
    setShown(shown.filter((_, i) => i !== selected));
    setSelected(0);
  };
  const edit = (cid: string | null) => {
    setEditing(cid);
    setSelected(0);
  };
  const addVariant = (cid: string) => {
    setVariants([...variants, { controllerId: cid, stops: shown }]);
    edit(cid);
  };
  const removeVariant = () => {
    setVariants(variants.filter((v) => v !== variant));
    edit(null);
  };

  const sorted = (s: PaletteStop[]) => [...s].sort((a, b) => a.pos - b.pos);
  const submit = () =>
    save.mutate(
      { name: name.trim(), stops: sorted(stops), variants: variants.map((v) => ({ ...v, stops: sorted(v.stops) })) },
      { onSuccess: () => navigate({ to: "/palettes" }) },
    );

  const remove = () => {
    if (existing && confirm(`Delete palette "${existing.name}"? Controllers lose it on their next sync.`))
      del.mutate(existing.id, { onSuccess: () => navigate({ to: "/palettes" }) });
  };

  const withoutVariant = controllers.filter((c) => !variants.some((v) => v.controllerId === c.id));
  const tab = (active: boolean) =>
    `rounded-t-md border-b-2 px-3 py-1.5 text-sm ${active ? "border-sky-500 text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-200"}`;

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
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-sm">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset glow" autoFocus={!id} />
            </div>
            <div className="flex rounded-md border border-neutral-700 p-0.5 text-sm" role="group" aria-label="Edit on">
              {(["gradient", "leds"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => chooseView(v)}
                  className={`rounded px-3 py-1 ${view === v ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
                >
                  {v === "gradient" ? "Gradient" : "On the LEDs"}
                </button>
              ))}
            </div>
          </div>
          {controllers.length > 1 || variants.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-end gap-1 border-b border-neutral-800">
              <button type="button" className={tab(!variant)} onClick={() => edit(null)}>
                {variants.length ? "Other controllers" : "All controllers"}
              </button>
              {variants.map((v) => (
                <button key={v.controllerId} type="button" className={tab(v === variant)} onClick={() => edit(v.controllerId)}>
                  {controllerName(v.controllerId)}
                </button>
              ))}
              {withoutVariant.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && addVariant(e.target.value)}
                  className="mb-1 ml-auto rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-300"
                >
                  <option value="">+ Version for a controller…</option>
                  {withoutVariant.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          ) : null}
          {(variant || variants.length > 0) && (
            <p className="mb-2 text-xs text-neutral-500">
              {variant
                ? `${controllerName(variant.controllerId)} gets these stops instead of the palette's own.`
                : "Controllers without their own version get these stops."}
            </p>
          )}
          {view === "leds" ? (
            <div className="mb-4">
              <LedPaletteEditor
                key={editing ?? ""}
                controllers={controllers}
                lockedTo={variant?.controllerId}
                stops={shown}
                onChange={setShown}
                selected={selected}
                onSelect={setSelected}
                maxStops={MAX_STOPS}
              />
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-neutral-500">
                Click the bar to add a stop ({shown.length}/{MAX_STOPS}). Drag handles or use arrow keys to move them.
              </p>
              <GradientEditor stops={shown} onChange={setShown} selected={selected} onSelect={setSelected} maxStops={MAX_STOPS} />
            </>
          )}
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
              <Button variant="danger" onClick={removeStop} disabled={shown.length <= 2}>
                Remove stop
              </Button>
              {variant && (
                <Button variant="danger" onClick={removeVariant}>
                  Remove {controllerName(variant.controllerId)}'s version
                </Button>
              )}
            </div>
          </div>
        </Card>
        <DeviceTools
          key={editing ?? ""}
          preferredId={variant?.controllerId}
          stops={shown}
          onLoad={(s) => { setShown(s); setSelected(0); }}
        />
      </div>
    </div>
  );
}

/** Start from a controller's built-in palette, or preview the current stops on a controller. */
function DeviceTools({
  stops,
  onLoad,
  preferredId,
}: {
  stops: PaletteStop[];
  onLoad: (stops: PaletteStop[]) => void;
  /** Controller to start with, when editing its own version. */
  preferredId?: string;
}) {
  const { data: controllers = [] } = useControllers();
  const online = controllers.filter((c) => c.status === "online");
  const [controllerId, setControllerId] = useState<string>();
  const activeId = controllerId ?? online.find((c) => c.id === preferredId)?.id ?? online[0]?.id;
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
