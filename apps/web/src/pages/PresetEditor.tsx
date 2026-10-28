import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  applyGroupEdit,
  definitionLabel,
  groupSets,
  joinGroup,
  linkSegment,
  litLeds,
  moveSegment,
  overlappingSegments,
  presetState,
  presetSkipReason,
  removeGroupMember,
  renumberSegments,
  resolveSegmentRef,
  setClearOthers,
  type Controller,
  type PresetInput,
  type PresetState,
  type Segment,
  type SegmentGroup,
} from "@wled-manager/shared";
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
import { isClearMarker, newSegment, rawKind } from "../components/preset/describe";
import { TRANSITION_STYLES } from "../components/preset/wled-options";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

/** Colors telling segment groups apart. */
const GROUP_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c", "#f87171"];
const groupColor = (k: number) => GROUP_COLORS[k % GROUP_COLORS.length]!;

export function NewPreset() {
  const { folder } = useSearch({ from: "/presets/new" });
  return <PresetEditor folder={folder} />;
}

export function EditPreset() {
  const { id } = useParams({ from: "/presets/$id" });
  return <PresetEditor id={id} />;
}

function PresetEditor({ id, folder }: { id?: string; folder?: string }) {
  const { data: existing, error: loadError } = usePreset(id);
  const { data: allPresets = [], isSuccess: presetsLoaded } = usePresets();
  const { data: palettes = [] } = usePalettes();
  const { data: controllers = [] } = useControllers();
  const save = useSavePreset(id);
  const del = useDeletePreset();
  const navigate = useNavigate();

  const [controllerId, setControllerId] = useState<string>();
  // By default, work against a controller the preset goes to, preferring one that's online.
  const goesTo = (c: Controller) => !existing || !presetSkipReason(existing, c, controllers);
  const sourceController =
    controllers.find((c) => c.id === controllerId) ??
    controllers.find((c) => goesTo(c) && c.status === "online") ??
    controllers.find(goesTo) ??
    controllers.find((c) => c.status === "online") ??
    controllers[0];
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
      // New presets turn the controller's other segments off, so only the segments added here show.
      const seg = Array.from({ length: 32 }, (_, id) => ({ id, stop: 0 }));
      setDraft({ slot: freeSlot, name: "", kind: "state", state: { on: true, bri: 128, transition: 7, seg }, ...(folder ? { folder } : {}) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, id, presetsLoaded]);

  const [jsonMode, setJsonMode] = useState(false);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Drag and drop: segments are dragged by their handle (so inputs stay usable) and dropped on another segment.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (loadError) return <ErrorText error={loadError} />;
  if (!draft) return null;

  const setState = (patch: Partial<PresetState>) => setDraft({ ...draft, state: { ...draft.state!, ...patch } });
  const segments = draft.state?.seg ?? [];
  const markers = segments.filter(isClearMarker).length;
  const groups = draft.groups ?? [];
  const setGroups = (next: SegmentGroup[]) => setDraft({ ...draft, groups: next });
  const groupIndexOf = (i: number) => groups.findIndex((g) => g.members.includes(i));
  const wledSets = groupSets(segments, groups);
  const setSegment = (i: number, next: Segment) => setState({ seg: segments.map((x, j) => (j === i ? next : x)) });
  // Array position is the segment ID when no "id" is given, so keep positions stable: with clear markers
  // present, removing a segment turns it into a marker and adding one takes the first marker's place.
  const removeSegment = (i: number) =>
    setDraft({
      ...draft,
      state: renumberSegments({
        ...draft.state!,
        seg: markers ? segments.map((x, j) => (j === i ? { stop: 0 } : x)) : segments.filter((_, j) => j !== i),
      }),
      groups: removeGroupMember(groups, i, !markers),
    });
  const move = (from: number, to: number) => {
    const moved = moveSegment(draft.state!, groups, from, to);
    setDraft({ ...draft, state: moved.state, groups: moved.groups });
  };
  const realPositions = segments.flatMap((s, p) => (isClearMarker(s) ? [] : [p]));
  const membersOf = (k: number) => realPositions.filter((p) => groups[k]!.members.includes(p));
  const ungrouped = realPositions.filter((p) => groupIndexOf(p) === -1);
  /** The segment before or after `i` in its group, or among the ungrouped ones. */
  const neighbor = (i: number, delta: number) => {
    const k = groupIndexOf(i);
    const list = k >= 0 ? membersOf(k) : ungrouped;
    return list[list.indexOf(i) + delta];
  };
  const definitions = sourceController?.segments ?? [];
  const maxSegments = sourceController?.device?.maxSegments ?? 32;
  /** Where a segment's defined segment lands on the selected controller. */
  const resolveRef = (sid: string) =>
    sourceController ? resolveSegmentRef(sid, sourceController, controllers) : ({ ok: false, error: "no controller selected" } as const);
  const resolutions = segments.map((s) => (s.sid && !isClearMarker(s) ? resolveRef(s.sid) : undefined));
  /** LEDs a segment covers on the selected controller, if known. */
  const geometry = segments.map((s, p) => {
    if (isClearMarker(s)) return undefined;
    const r = resolutions[p];
    if (r?.ok) return r.segment;
    return s.start !== undefined && s.stop !== undefined && s.stop > s.start ? { start: s.start, stop: s.stop } : undefined;
  });
  const overlaps = overlappingSegments(geometry);
  const segmentLabel = (p: number) => {
    const r = resolutions[p];
    if (r?.ok) return definitionLabel(r.definition, definitions.indexOf(r.definition));
    const n = segments[p]?.n;
    return typeof n === "string" && n ? n : `Segment ${segments[p]?.id ?? p}`;
  };
  const usedSids = new Set(segments.flatMap((s) => (s.sid ? [s.sid] : [])));
  /** A new preset segment using a definition; grouping, spacing and offset start plain so nothing carries over. */
  const fromDefinition = (sid: string, base: Segment): Segment | undefined => {
    const r = resolveRef(sid);
    return r.ok ? linkSegment({ grp: 1, spc: 0, of: 0, ...base }, sid, r.segment) : undefined;
  };
  /**
   * Puts segment `i` in group `k` (out of any other), or in no group (null), or a new group ("new"). Joining an
   * existing group gives it the group's settings.
   */
  const setSegmentGroup = (i: number, k: number | null | "new") => {
    if (k === "new") {
      setGroups([...joinGroup(segments, groups, i, null).groups, { name: `Group ${groups.length + 1}`, members: [i] }]);
      setOpenGroup(groups.length);
    } else {
      const next = joinGroup(segments, groups, i, k);
      setDraft({ ...draft, state: { ...draft.state!, seg: next.seg }, groups: next.groups });
    }
  };
  /** Dropping a segment on another moves it there, into the other segment's group (or out of groups). */
  const dropOn = (from: number, to: number) => {
    const k = groupIndexOf(to);
    const moved = moveSegment(draft.state!, groups, from, to);
    if (k === groupIndexOf(from)) return setDraft({ ...draft, state: moved.state, groups: moved.groups });
    const next = joinGroup(moved.state.seg, moved.groups, realPositions.indexOf(to), k === -1 ? null : k);
    setDraft({ ...draft, state: { ...moved.state, seg: next.seg }, groups: next.groups });
  };
  const toggleCollapsed = (k: number, open?: boolean) => {
    const next = new Set(collapsed);
    if (open ?? next.has(k)) next.delete(k);
    else next.add(k);
    setCollapsed(next);
  };
  const deleteGroup = (k: number) => {
    setGroups(groups.filter((_, j) => j !== k));
    setOpenGroup(null);
    setCollapsed(new Set([...collapsed].flatMap((j) => (j < k ? [j] : j > k ? [j - 1] : []))));
  };
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };
  /** Adds segments, each taking the first clear marker's place, or at the end; into group `k` if given. */
  const addSegments = (added: Segment[], k?: number) => {
    let seg = [...segments];
    let nextGroups = groups;
    const at: number[] = [];
    for (const x of added) {
      const p = seg.findIndex(isClearMarker);
      if (p === -1) seg.push(x);
      else seg[p] = x;
      at.push(p === -1 ? seg.length - 1 : p);
    }
    seg = seg.slice(0, 32);
    if (k !== undefined)
      for (const p of at.filter((p) => p < seg.length)) ({ seg, groups: nextGroups } = joinGroup(seg, nextGroups, p, k));
    setDraft({ ...draft, state: renumberSegments({ ...draft.state!, seg }), groups: nextGroups });
  };
  const onAdd = (v: string, k?: number) => {
    if (v === "custom") addSegments([newSegment(rgbw)], k);
    else if (v === "all")
      addSegments(
        definitions.filter((d) => !usedSids.has(d.id)).flatMap((d): Segment[] => {
          const seg = fromDefinition(d.id, newSegment(rgbw));
          return seg ? [seg] : [];
        }),
        k,
      );
    else {
      const seg = fromDefinition(v, newSegment(rgbw));
      if (seg) addSegments([seg], k);
    }
  };
  /** The "+ Add segment…" picker; inside a group, added segments join it. */
  const addPicker = (k?: number) => (
    <select
      value=""
      onChange={(e) => onAdd(e.target.value, k)}
      disabled={realCount >= maxSegments}
      aria-label={k === undefined ? "Add segment" : `Add segment to ${groups[k]!.name}`}
      className={
        k === undefined
          ? "rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm hover:bg-neutral-700"
          : "w-fit rounded-md border border-dashed border-neutral-700 bg-transparent px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
      }
    >
      <option value="" disabled>{k === undefined ? "+ Add segment…" : `+ Add segment to ${groups[k]!.name}…`}</option>
      {definitions.length > 0 && (
        <optgroup label={`Defined on ${sourceController!.name}`}>
          {definitions.map((d, j) => (
            <option key={d.id} value={d.id} disabled={usedSids.has(d.id) || !resolveRef(d.id).ok}>
              {definitionLabel(d, j)}
              {usedSids.has(d.id) ? " (added)" : !resolveRef(d.id).ok ? " (doesn't fit)" : ""}
            </option>
          ))}
          {definitions.filter((d) => !usedSids.has(d.id)).length > 1 && <option value="all">All not yet added</option>}
        </optgroup>
      )}
      <option value="custom">Custom LEDs</option>
    </select>
  );
  const realCount = segments.length - markers;
  const toggleClearOthers = (on: boolean) => {
    const next = setClearOthers(draft.state!, groups, on, Math.max(maxSegments, realCount));
    setDraft({ ...draft, state: next.state, groups: next.groups });
  };
  /** One segment's card, draggable onto other segments. */
  const segmentCard = (i: number) => {
    const s = segments[i]!;
    const k = groupIndexOf(i);
    const dropHere = dragFrom !== null && dragOver === i && dragFrom !== i;
    return (
      <div
        key={i}
        onDragOver={(e) => {
          if (dragFrom === null) return;
          e.preventDefault();
          setDragOver(i);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragFrom !== null && dragFrom !== i) dropOn(dragFrom, i);
          endDrag();
        }}
        data-segment
        className={`rounded-lg ${dragFrom === i ? "opacity-40" : ""} ${
          dropHere ? (dragFrom! < i ? "shadow-[0_3px_0_0_#0ea5e9]" : "shadow-[0_-3px_0_0_#0ea5e9]") : ""
        }`}
      >
        <SegmentEditor
          index={i}
          segment={s}
          catalog={catalog}
          library={palettes}
          rgbw={rgbw}
          markers={sourceController?.markers ?? []}
          title={
            <>
              {segmentLabel(i)}
              {s.sid && <span className="text-xs font-normal text-neutral-500">segment {s.id ?? i}</span>}
            </>
          }
          hideGeometry={!!s.sid}
          source={
            <SourcePicker
              segment={s}
              resolution={resolutions[i]}
              controller={sourceController}
              usedSids={usedSids}
              onLink={(sid) => {
                const next = fromDefinition(sid, s);
                if (next) setSegment(i, next);
              }}
              onUnlink={() => {
                const { sid: _, ...rest } = s;
                setSegment(i, rest);
              }}
            />
          }
          onChange={(next) => setSegment(i, next)}
          onRemove={() => removeSegment(i)}
          leading={
            <span className="flex items-center">
              <span
                role="button"
                aria-label="Drag to reorder"
                title="Drag to reorder"
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                  // Show the whole segment card under the pointer, not just the handle.
                  const card = e.currentTarget.closest("[data-segment]");
                  if (card) e.dataTransfer.setDragImage(card, 24, 16);
                }}
                onDragEnd={endDrag}
                className="cursor-grab px-1 text-neutral-500 select-none hover:text-neutral-200 active:cursor-grabbing"
              >
                ⠿
              </span>
              <button
                type="button"
                aria-label="Move up"
                disabled={neighbor(i, -1) === undefined}
                onClick={() => move(i, neighbor(i, -1)!)}
                className="px-0.5 text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={neighbor(i, 1) === undefined}
                onClick={() => move(i, neighbor(i, 1)!)}
                className="px-0.5 text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
              >
                ↓
              </button>
            </span>
          }
          headerExtra={
            <select
              value={k >= 0 ? String(k) : ""}
              aria-label="Group"
              onChange={(e) =>
                setSegmentGroup(i, e.target.value === "" ? null : e.target.value === "new" ? "new" : Number(e.target.value))
              }
              className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
              style={k >= 0 ? { color: groupColor(k) } : undefined}
            >
              <option value="">No group</option>
              {groups.map((g, j) => (
                <option key={j} value={j}>{g.name}</option>
              ))}
              <option value="new">New group…</option>
            </select>
          }
        />
      </div>
    );
  };
  const folders = [...new Set(allPresets.flatMap((p) => (p.folder ? [p.folder] : [])))].sort((a, b) => a.localeCompare(b));
  const slotTaken = allPresets.find((p) => p.slot === draft.slot && p.id !== id);

  const submit = () => {
    // Keep the saved LEDs of defined segments current, so the stored preset reads correctly on its own (e.g. as JSON).
    // Presets saved before IDs followed positions may repeat an ID; renumbering fixes them on save.
    const state = draft.state && renumberSegments({
      ...draft.state,
      seg: draft.state.seg.map((s, p) => {
        const r = resolutions[p];
        return s.sid && r?.ok ? linkSegment(s, s.sid, r.segment) : s;
      }),
    });
    save.mutate({ ...draft, name: draft.name.trim(), folder: draft.folder?.trim() || undefined, state }, { onSuccess: () => navigate({ to: "/presets" }) });
  };
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
            {id && draft.kind === "state" && (
              <Button onClick={() => navigate({ to: "/simulator", search: { preset: id } })} title="Try this preset on simulated LEDs">
                Simulate
              </Button>
            )}
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
            <div className="grid grid-cols-[1fr_10rem_6rem_5rem] gap-3">
              <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus={!id} />
              <Input
                label="Preset group"
                value={draft.folder ?? ""}
                list="preset-folders"
                maxLength={40}
                placeholder="None"
                title="Groups only organize the presets list in this app; controllers never see them."
                onChange={(e) => setDraft({ ...draft, folder: e.target.value.trim() ? e.target.value : undefined })}
              />
              <datalist id="preset-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
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
                  {groups.map((g, k) => (
                    <GroupSection
                      key={k}
                      group={g}
                      color={groupColor(k)}
                      wledSet={wledSets[k]!}
                      sharedSet={wledSets.filter((x) => x === wledSets[k]).length > 1}
                      collapsed={collapsed.has(k)}
                      editing={openGroup === k}
                      memberLabels={membersOf(k).map(segmentLabel)}
                      dropTarget={dragFrom !== null && groupIndexOf(dragFrom) !== k}
                      onDrop={() => dragFrom !== null && setSegmentGroup(dragFrom, k)}
                      onDragEnd={endDrag}
                      onCollapse={() => toggleCollapsed(k)}
                      onEdit={() => {
                        setOpenGroup(openGroup === k ? null : k);
                        toggleCollapsed(k, true);
                      }}
                      onRename={(name) => setGroups(groups.map((x, j) => (j === k ? { ...x, name } : x)))}
                      onDelete={() => deleteGroup(k)}
                      editor={
                        membersOf(k)[0] !== undefined && (
                          <SegmentEditor
                            index={membersOf(k)[0]!}
                            segment={segments[membersOf(k)[0]!]!}
                            title={`Edit ${plural(membersOf(k).length, "segment")} together`}
                            hideGeometry
                            catalog={catalog}
                            library={palettes}
                            rgbw={rgbw}
                            markers={[]}
                            onChange={(next) =>
                              setState({ seg: applyGroupEdit(segments, membersOf(k), segments[membersOf(k)[0]!]!, next) })
                            }
                          />
                        )
                      }
                    >
                      {membersOf(k).map(segmentCard)}
                      {addPicker(k)}
                    </GroupSection>
                  ))}
                  {groups.length > 0 && ungrouped.length > 0 && (
                    <h3 className="-mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">Not in a group</h3>
                  )}
                  {ungrouped.map(segmentCard)}
                  {realCount === 0 && (
                    <p className="text-sm text-neutral-500">
                      No segments yet. Add the controller's defined segments this preset should light, or a custom one.
                    </p>
                  )}
                  {overlaps.length > 0 && (
                    <p className="rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">
                      These segments share LEDs: {overlaps.map(([a, b]) => `${segmentLabel(a)} & ${segmentLabel(b)}`).join(", ")}. The
                      controller allows this; the later segment draws on top.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {addPicker()}
                    {sourceController && (
                      <Link
                        to="/controllers/$id/segments"
                        params={{ id: sourceController.id }}
                        className="text-xs text-sky-400 hover:underline"
                      >
                        {definitions.length ? "Edit defined segments" : "Define segments"}
                      </Link>
                    )}
                    <label
                      className="ml-auto flex items-center gap-1.5 text-xs text-neutral-400"
                      title={`Pads the preset with empty segments up to the controller's limit of ${maxSegments}`}
                    >
                      <input type="checkbox" checked={markers > 0} onChange={(e) => toggleClearOthers(e.target.checked)} />
                      Turn off the controller's other segments
                    </label>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {controllers.length > 0 && (
            <TargetsPanel
              preset={draft}
              controllers={controllers}
              onChange={(chosen) => setDraft({ ...draft, controllers: chosen })}
            />
          )}
          <TestPanel
            preset={draft}
            controllers={controllers}
            selectedId={sourceController?.id}
            onSelect={setControllerId}
          />
        </div>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const describeLeds = (s: { start: number; stop: number }) =>
  `LED${s.stop - s.start > 1 ? `s ${s.start}–${s.stop - 1}` : ` ${s.start}`} · ${plural(s.stop - s.start, "LED")}`;

/** Chooses a controller-defined segment for a preset segment, or custom LEDs, and says where it lands. */
function SourcePicker({
  segment: s,
  resolution: r,
  controller,
  usedSids,
  onLink,
  onUnlink,
}: {
  segment: Segment;
  resolution: ReturnType<typeof resolveSegmentRef> | undefined;
  controller: Controller | undefined;
  usedSids: Set<string>;
  onLink: (sid: string) => void;
  onUnlink: () => void;
}) {
  const definitions = controller?.segments ?? [];
  // A definition from another controller matched by name shows as that controller's segment.
  const value = s.sid ? (r?.ok ? r.definition.id : s.sid) : "";
  const known = definitions.some((d) => d.id === value);
  const lit = r?.ok && (s.spc ?? 0) > 0 ? litLeds({ ...r.segment, grp: s.grp ?? 1, spc: s.spc ?? 0 }).length : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-neutral-400">LEDs from</span>
      <select
        value={value}
        onChange={(e) => (e.target.value ? onLink(e.target.value) : onUnlink())}
        aria-label="Defined segment"
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
      >
        <option value="">Custom LEDs</option>
        {s.sid && !known && <option value={value}>{typeof s.n === "string" && s.n ? s.n : "Defined segment"} (not on this controller)</option>}
        {definitions.map((d, j) => (
          <option key={d.id} value={d.id} disabled={d.id !== value && usedSids.has(d.id)}>
            {definitionLabel(d, j)}
          </option>
        ))}
      </select>
      {r?.ok && (
        <span className="text-xs text-neutral-500">
          {describeLeds(r.segment)}
          {r.segment.rev && " · runs backwards"}
          {lit !== undefined && ` · ${lit} lit`}
          {r.byName && ` · matched by name on ${controller?.name}`}
        </span>
      )}
      {r && !r.ok && (
        <span className="text-xs text-amber-300">
          On {controller?.name ?? "this controller"} {r.error}, so this segment is left out there.
        </span>
      )}
      {!s.sid && definitions.length > 0 && (
        <span className="text-xs text-neutral-500">or pick a defined segment to follow its LEDs</span>
      )}
    </div>
  );
}

/**
 * A segment group: a collapsible section holding its segments, with an editor whose changes apply to all of
 * them. Segments dragged onto the header join the group.
 */
function GroupSection({
  group,
  color,
  wledSet,
  sharedSet,
  collapsed,
  editing,
  memberLabels,
  dropTarget,
  onDrop,
  onDragEnd,
  onCollapse,
  onEdit,
  onRename,
  onDelete,
  editor,
  children,
}: {
  group: SegmentGroup;
  color: string;
  /** WLED segment set (0–3, shown as 1–4 like WLED's ➊–➍) the group's segments go in. */
  wledSet: number;
  /** Other groups are in the same set: WLED only has four. */
  sharedSet: boolean;
  collapsed: boolean;
  /** The edit-together editor is showing. */
  editing: boolean;
  memberLabels: string[];
  /** A segment from elsewhere is being dragged, so the header accepts it. */
  dropTarget: boolean;
  onDrop: () => void;
  onDragEnd: () => void;
  onCollapse: () => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  editor: ReactNode;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <section className="rounded-lg border border-l-4 border-neutral-800" style={{ borderLeftColor: color }}>
      <div
        className={`flex flex-wrap items-center gap-2 rounded-t-lg p-3 text-sm ${over && dropTarget ? "bg-neutral-800" : ""}`}
        onDragOver={(e) => {
          if (!dropTarget) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (dropTarget) onDrop();
          onDragEnd();
        }}
      >
        <button
          type="button"
          onClick={onCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          className="w-4 text-neutral-400 hover:text-neutral-100"
        >
          <span className={`inline-block transition-transform ${collapsed ? "" : "rotate-90"}`}>▸</span>
        </button>
        <input
          value={group.name}
          onChange={(e) => onRename(e.target.value)}
          onBlur={(e) => !e.target.value.trim() && onRename("Group")}
          maxLength={32}
          aria-label="Group name"
          className="w-40 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-neutral-700 focus:border-neutral-600"
          style={{ color }}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-500" title={memberLabels.join(", ")}>
          {!memberLabels.length
            ? "No segments yet: add one below or drag one here"
            : collapsed
              ? memberLabels.join(", ")
              : plural(memberLabels.length, "segment")}
        </span>
        <span
          className={`rounded bg-neutral-800 px-1.5 py-0.5 text-xs ${sharedSet ? "text-amber-300" : "text-neutral-400"}`}
          title={
            sharedSet
              ? "WLED has four segment sets, so the last one is shared by the groups that don't fit."
              : "The segment set these segments go in on the controller"
          }
        >
          WLED set {wledSet + 1}
          {sharedSet && " (shared)"}
        </span>
        <div className="flex items-center gap-3 text-xs">
          {memberLabels.length > 0 && (
            <button type="button" onClick={onEdit} className="text-sky-400 hover:text-sky-300">
              {editing && !collapsed ? "Done" : "Edit together"}
            </button>
          )}
          <button type="button" onClick={onDelete} className="text-neutral-500 hover:text-red-400" title="Ungroup (keeps the segments)">
            Ungroup
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {editing && memberLabels.length > 0 && (
            <div className="rounded-lg bg-neutral-900/60 p-2">
              <p className="mb-2 text-xs text-neutral-500">
                Showing {memberLabels[0]}'s settings. Anything you change here is copied to all {memberLabels.length} segments;
                settings you don't touch stay as they are on each segment. Segments added to the group take these settings.
              </p>
              {editor}
            </div>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

/** Which controllers the preset syncs to: all, or chosen ones; and where its segments keep it off. */
function TargetsPanel({
  preset,
  controllers,
  onChange,
}: {
  preset: PresetInput;
  controllers: Controller[];
  onChange: (chosen: string[] | undefined) => void;
}) {
  const chosen = preset.controllers;
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...(chosen ?? []), id] : (chosen ?? []).filter((x) => x !== id);
    // Keep at least one: an empty choice would sync nowhere.
    if (next.length) onChange(next);
  };
  return (
    <Card className="flex h-fit flex-col gap-2 text-sm">
      <h2 className="font-medium">Syncs to</h2>
      <label className="flex items-center gap-2">
        <input type="radio" checked={!chosen} onChange={() => onChange(undefined)} />
        All controllers
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={!!chosen} onChange={() => onChange(controllers.map((c) => c.id))} />
        Only these:
      </label>
      <ul className="flex flex-col gap-1 pl-5">
        {controllers.map((c) => {
          const reason = presetSkipReason({ ...preset, controllers: undefined }, c, controllers);
          const picked = !chosen || chosen.includes(c.id);
          return (
            <li key={c.id}>
              <label className={`flex items-center gap-2 ${chosen ? "" : "text-neutral-400"}`}>
                <input
                  type="checkbox"
                  checked={picked}
                  disabled={!chosen || (picked && chosen.length === 1)}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                {c.name}
              </label>
              {picked && reason && <p className="pl-6 text-xs text-amber-400">Skipped: {reason}.</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-neutral-500">
        A preset using defined segments only goes to controllers where at least one of them is defined (by name on
        other controllers). Syncing removes it from controllers it no longer goes to.
      </p>
    </Card>
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
