import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { presetState, type PresetInput, type PresetState, type Segment } from "@wled-manager/shared";
import {
  useCatalog,
  useControllers,
  useDeletePreset,
  usePalettes,
  usePreset,
  usePresets,
  usePresetTest,
  useSavePreset,
} from "../queries";
import { SegmentEditor } from "../components/preset/SegmentEditor";
import { isClearMarker, rawKind } from "../components/preset/describe";
import { TRANSITION_STYLES } from "../components/preset/wled-options";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

export function NewPreset() {
  return <PresetEditor />;
}

export function EditPreset() {
  const { id } = useParams({ from: "/presets/$id" });
  return <PresetEditor id={id} />;
}

const newSegment = (rgbw: boolean): Segment => ({
  fx: 0,
  fxName: "Solid",
  sx: 128,
  ix: 128,
  col: [rgbw ? [255, 160, 0, 0] : [255, 160, 0]],
  pal: 0,
});

function PresetEditor({ id }: { id?: string }) {
  const { data: existing, error: loadError } = usePreset(id);
  const { data: allPresets = [], isSuccess: presetsLoaded } = usePresets();
  const { data: palettes = [] } = usePalettes();
  const { data: controllers = [] } = useControllers();
  const save = useSavePreset(id);
  const del = useDeletePreset();
  const navigate = useNavigate();

  const [controllerId, setControllerId] = useState<string>();
  const sourceController =
    controllers.find((c) => c.id === controllerId) ?? controllers.find((c) => c.status === "online") ?? controllers[0];
  const { data: catalog } = useCatalog(sourceController?.id);
  const rgbw = sourceController?.device?.rgbw ?? false;

  const freeSlot = useMemo(() => {
    const used = new Set(allPresets.map((p) => p.slot));
    for (let s = 1; s <= 250; s++) if (!used.has(s)) return s;
    return 250;
  }, [allPresets]);

  const [draft, setDraft] = useState<PresetInput | null>(null);
  useEffect(() => {
    if (existing) {
      const { id: _, revision, updatedAt, ...input } = existing;
      setDraft(input);
    } else if (!id && !draft && presetsLoaded) {
      setDraft({ slot: freeSlot, name: "", kind: "state", state: { on: true, bri: 128, transition: 7, seg: [newSegment(rgbw)] } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, id, presetsLoaded]);

  const [jsonMode, setJsonMode] = useState(false);

  if (loadError) return <ErrorText error={loadError} />;
  if (!draft) return null;

  const setState = (patch: Partial<PresetState>) => setDraft({ ...draft, state: { ...draft.state!, ...patch } });
  const segments = draft.state?.seg ?? [];
  const markers = segments.filter(isClearMarker).length;
  const setSegment = (i: number, next: Segment) => setState({ seg: segments.map((x, j) => (j === i ? next : x)) });
  // Array position is the segment ID when no "id" is given, so keep positions stable: with clear markers
  // present, removing a segment turns it into a marker and adding one takes the first marker's place.
  const removeSegment = (i: number) =>
    setState({ seg: markers ? segments.map((x, j) => (j === i ? { stop: 0 } : x)) : segments.filter((_, j) => j !== i) });
  const addSegment = () => {
    const at = segments.findIndex(isClearMarker);
    if (at === -1) setState({ seg: [...segments, { ...newSegment(rgbw), id: segments.length }] });
    else setSegment(at, { ...newSegment(rgbw), id: at });
  };
  const slotTaken = allPresets.find((p) => p.slot === draft.slot && p.id !== id);

  const submit = () => save.mutate({ ...draft, name: draft.name.trim() }, { onSuccess: () => navigate({ to: "/presets" }) });
  const remove = () => {
    if (existing && confirm(`Delete preset "${existing.name}"? Controllers lose it on their next sync.`))
      del.mutate(existing.id, { onSuccess: () => navigate({ to: "/presets" }) });
  };

  return (
    <div>
      <PageHeader
        title={id ? `Edit ${existing?.name ?? "preset"}` : "New preset"}
        actions={
          <>
            {id && <Button variant="danger" onClick={remove}>Delete</Button>}
            <Button onClick={() => navigate({ to: "/presets" })}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={save.isPending || !draft.name.trim() || !!slotTaken}>
              Save
            </Button>
          </>
        }
      />
      <ErrorText error={save.error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <div className="grid grid-cols-[1fr_6rem_5rem] gap-3">
              <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus={!id} />
              <Input
                label="Slot (1–250)"
                type="number"
                min={1}
                max={250}
                value={draft.slot}
                onChange={(e) => setDraft({ ...draft, slot: Math.min(250, Math.max(1, Number(e.target.value) || 1)) })}
              />
              <Input
                label="Label"
                value={draft.ql ?? ""}
                maxLength={8}
                placeholder="–"
                onChange={(e) => setDraft({ ...draft, ql: e.target.value || undefined })}
              />
            </div>
            {slotTaken && <p className="mt-2 text-xs text-red-400">Slot {draft.slot} is used by "{slotTaken.name}".</p>}
            <p className="mt-2 text-xs text-neutral-500">
              The slot is the preset number on every controller, as used by buttons, playlists and integrations.
            </p>
          </Card>

          {draft.kind === "raw" ? (
            <Card>
              <h2 className="mb-1 font-medium">{rawKind(draft.raw)}</h2>
              <p className="mb-3 text-xs text-neutral-500">
                This preset is stored exactly as written below (without its name and label).
              </p>
              <JsonEditor value={draft.raw ?? {}} onChange={(raw) => setDraft({ ...draft, raw: raw as Record<string, unknown> })} />
            </Card>
          ) : (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium">Light state</h2>
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <input type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} />
                  Edit as JSON
                </label>
              </div>
              {jsonMode ? (
                <JsonEditor
                  value={draft.state}
                  validate={(v) => presetState.safeParse(v).error?.issues[0]?.message}
                  onChange={(state) => setDraft({ ...draft, state: state as PresetState })}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-[auto_1fr_7rem_10rem] items-end gap-4 text-sm">
                    <label className="flex items-center gap-2 pb-1">
                      <input type="checkbox" checked={draft.state!.on ?? true} onChange={(e) => setState({ on: e.target.checked })} />
                      On
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="flex justify-between text-xs text-neutral-400">
                        Brightness <span>{draft.state!.bri ?? "–"}</span>
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={255}
                        value={draft.state!.bri ?? 128}
                        onChange={(e) => setState({ bri: Number(e.target.value) })}
                        className="accent-sky-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-400">Transition (s)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={(draft.state!.transition ?? 7) / 10}
                        onChange={(e) => setState({ transition: Math.round(Number(e.target.value) * 10) })}
                        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-400">Transition style</span>
                      <select
                        value={draft.state!.bs ?? ""}
                        onChange={(e) => setState({ bs: e.target.value === "" ? undefined : Number(e.target.value) })}
                        title="How the preset blends in when it loads. Needs recent WLED firmware."
                        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                      >
                        <option value="">(unchanged)</option>
                        {TRANSITION_STYLES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}{t.matrix ? " (2D)" : ""}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {segments.map((s, i) =>
                    isClearMarker(s) ? null : (
                      <SegmentEditor
                        key={i}
                        index={i}
                        segment={s}
                        catalog={catalog}
                        library={palettes}
                        rgbw={rgbw}
                        markers={sourceController?.markers ?? []}
                        onChange={(next) => setSegment(i, next)}
                        onRemove={() => removeSegment(i)}
                      />
                    ),
                  )}
                  <div className="flex items-center gap-3">
                    <Button onClick={addSegment}>Add segment</Button>
                    {markers > 0 && (
                      <span className="text-xs text-neutral-500">
                        Loading this preset also turns off {markers} other segment{markers === 1 ? "" : "s"}.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <TestPanel
          preset={draft}
          controllers={controllers}
          selectedId={sourceController?.id}
          onSelect={setControllerId}
        />
      </div>
    </div>
  );
}

function TestPanel({
  preset,
  controllers,
  selectedId,
  onSelect,
}: {
  preset: PresetInput;
  controllers: ReturnType<typeof useControllers>["data"] & {};
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const test = usePresetTest();
  const selected = controllers.find((c) => c.id === selectedId);
  if (!controllers.length)
    return (
      <Card>
        <p className="text-sm text-neutral-400">Add a controller to pick effects by name and test presets live.</p>
      </Card>
    );
  return (
    <Card className="flex h-fit flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">Controller</span>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5"
        >
          {controllers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.status !== "online" ? " (offline)" : ""}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-neutral-500">Effect and palette lists come from this controller.</p>
      <Button
        onClick={() => selectedId && test.mutate({ controllerId: selectedId, preset })}
        disabled={test.isPending || selected?.status !== "online"}
      >
        {test.isPending ? "Sending…" : "Test on controller"}
      </Button>
      <p className="text-xs text-neutral-500">
        Applies this preset to the controller's lights now without saving it there. Library palettes appear only once synced.
      </p>
      {test.data?.warnings.map((w) => (
        <p key={w} className="rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">{w}</p>
      ))}
      {test.isSuccess && !test.data.warnings.length && <p className="text-xs text-emerald-400">Applied.</p>}
      <ErrorText error={test.error} />
    </Card>
  );
}

/** Textarea JSON editor that only reports valid values. */
function JsonEditor({
  value,
  onChange,
  validate,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  validate?: (v: unknown) => string | undefined;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();
  return (
    <div>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            const problem = validate?.(parsed);
            setError(problem);
            if (!problem) onChange(parsed);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
        className="h-80 w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 font-mono text-xs"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
