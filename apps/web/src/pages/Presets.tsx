import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { presetPaletteIds, presetSkipReason, stopsToCss, type Preset } from "@wled-manager/shared";
import { useCatalog, useControllers, useMovePresets, usePalettes, usePresets, useSetPresetSync } from "../queries";
import { effectNames, rawKind, realSegments } from "../components/preset/describe";
import { Button, Card, ErrorText, PageHeader } from "../components/ui";

/** Collapsed groups on the presets page, by name ("" for presets in no group). */
const COLLAPSED_KEY = "presetGroupsCollapsed";
const loadCollapsed = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
};

/** Mime type for preset rows dragged onto a group header. */
const DRAG_TYPE = "application/x-wled-presets";

export function Presets() {
  const { data: presets = [], isLoading } = usePresets();
  const { data: palettes = [] } = usePalettes();
  const { data: controllers = [] } = useControllers();
  const { data: catalog } = useCatalog(controllers[0]?.id);
  const move = useMovePresets();
  const setSync = useSetPresetSync();
  const syncTo = (ids: string[], sync: boolean) => {
    if (ids.length) setSync.mutate({ ids, sync });
  };
  const syncing = (p: Preset) => p.sync !== false;

  const [collapsed, setCollapsedState] = useState(loadCollapsed);
  const setCollapsed = (next: Set<string>) => {
    setCollapsedState(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };
  const toggle = (folder: string) => {
    const next = new Set(collapsed);
    if (!next.delete(folder)) next.add(folder);
    setCollapsed(next);
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  // Named groups alphabetically, then presets in no group.
  const names = [...new Set(presets.flatMap((p) => (p.folder ? [p.folder] : [])))].sort((a, b) => a.localeCompare(b));
  const sections: { folder: string; presets: Preset[] }[] = names.map((folder) => ({
    folder,
    presets: presets.filter((p) => p.folder === folder),
  }));
  const loose = presets.filter((p) => !p.folder);
  if (loose.length) sections.push({ folder: "", presets: loose });
  const grouped = names.length > 0;

  const moveTo = (ids: string[], folder: string | null) => {
    if (ids.length) move.mutate({ ids, folder }, { onSuccess: () => setSelected(new Set()) });
  };
  const askNewGroup = (ids: string[]) => {
    const name = prompt("New group name")?.trim();
    if (name) moveTo(ids, name.slice(0, 40));
  };
  const select = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };
  // Ignore selected presets that have since been deleted.
  const selectedIds = presets.filter((p) => selected.has(p.id)).map((p) => p.id);
  const columns = 7 + (controllers.length > 1 ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Presets"
        actions={
          <Link to="/presets/new">
            <Button variant="primary">New preset</Button>
          </Link>
        }
      />
      <ErrorText error={move.error ?? setSync.error} />
      {!isLoading && presets.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No presets yet. Create one, or import a controller's presets from its page under Controllers.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-2 flex min-h-8 flex-wrap items-center gap-3 text-sm">
            {selectedIds.length > 0 ? (
              <>
                <span className="text-neutral-300">{selectedIds.length} selected</span>
                <select
                  value=""
                  aria-label="Move selected presets to group"
                  onChange={(e) => {
                    const v = e.target.value;
                    const ids = selectedIds;
                    if (v === "\u0000new") askNewGroup(ids);
                    else moveTo(ids, v === "\u0000none" ? null : v);
                  }}
                  className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1"
                >
                  <option value="" disabled>Move to group…</option>
                  {names.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                  <option value={"\u0000new"}>New group…</option>
                  {grouped && <option value={"\u0000none"}>No group</option>}
                </select>
                <Button onClick={() => syncTo(selectedIds, true)} disabled={setSync.isPending} title="Sync these presets to their controllers again">
                  Sync on
                </Button>
                <Button
                  onClick={() => syncTo(selectedIds, false)}
                  disabled={setSync.isPending}
                  title="Keep these presets in the app only; the next sync removes them from controllers"
                >
                  Sync off
                </Button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-neutral-400 hover:text-neutral-200">
                  Clear selection
                </button>
              </>
            ) : (
              <span className="text-xs text-neutral-500">
                Select presets to put them in a group (or drag them onto one), or to turn their syncing on or off. Groups only
                organize this list; controllers never see them. Presets with sync off stay here but are removed from controllers
                at the next sync.
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-xs text-neutral-400">
                <tr>
                  <th className="w-8 py-2 pl-4">
                    <input
                      type="checkbox"
                      aria-label="Select all presets"
                      checked={selectedIds.length === presets.length}
                      onChange={(e) => select(presets.map((p) => p.id), e.target.checked)}
                    />
                  </th>
                  <th className="w-14 px-2 py-2 font-medium" title="Sync to controllers. Off keeps the preset in the app only.">
                    Sync
                  </th>
                  <th className="w-14 px-4 py-2 font-medium">Slot</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Contents</th>
                  <th className="px-4 py-2 font-medium">Palettes</th>
                  {controllers.length > 1 && <th className="px-4 py-2 font-medium">Syncs to</th>}
                  <th className="w-24 px-4 py-2" aria-label="Actions" />
                </tr>
              </thead>
              {sections.map(({ folder, presets: members }) => {
                const open = !grouped || !collapsed.has(folder);
                const ids = members.map((p) => p.id);
                const allSelected = ids.every((id) => selected.has(id));
                return (
                  <tbody key={folder || "\u0000none"} className="divide-y divide-neutral-800 border-t border-neutral-800">
                    {grouped && (
                      <tr
                        className={dropOn === folder ? "bg-sky-950/60" : "bg-neutral-900/40"}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                          e.preventDefault();
                          setDropOn(folder);
                        }}
                        onDragLeave={() => setDropOn(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropOn(null);
                          const dragged: string[] = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]");
                          moveTo(dragged.filter((id) => presets.find((p) => p.id === id)?.folder !== (folder || undefined)), folder || null);
                        }}
                      >
                        <td className="py-2 pl-4">
                          <input
                            type="checkbox"
                            aria-label={`Select all in ${folder || "no group"}`}
                            checked={allSelected}
                            onChange={(e) => select(ids, e.target.checked)}
                          />
                        </td>
                        <td colSpan={columns - 1} className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggle(folder)}
                              aria-expanded={open}
                              aria-label={`${open ? "Collapse" : "Expand"} ${folder || "presets in no group"}`}
                              className="flex items-center gap-2 rounded px-1 text-left hover:text-neutral-100"
                            >
                              <span className={`inline-block w-3 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                              {renaming !== folder && (
                                <span className={`font-medium ${folder ? "text-neutral-100" : "text-neutral-400 italic"}`}>
                                  {folder || "No group"}
                                </span>
                              )}
                            </button>
                            {renaming === folder && (
                              <input
                                autoFocus
                                defaultValue={folder}
                                maxLength={40}
                                aria-label="Group name"
                                onBlur={(e) => {
                                  const name = e.target.value.trim();
                                  setRenaming(null);
                                  if (!name || name === folder) return;
                                  moveTo(ids, name);
                                  // A collapsed group stays collapsed under its new name.
                                  if (collapsed.has(folder)) setCollapsed(new Set([...collapsed].filter((f) => f !== folder)).add(name));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setRenaming(null);
                                }}
                                className="w-48 rounded border border-neutral-600 bg-neutral-900 px-1.5 py-0.5 font-medium"
                              />
                            )}
                            <span className="text-xs text-neutral-500">
                              {members.length} preset{members.length === 1 ? "" : "s"}
                              {!open && `: ${members.map((p) => p.name).join(", ")}`}
                            </span>
                            <div className="ml-auto flex shrink-0 items-center gap-3 pr-2 text-xs">
                              <SyncSwitch
                                on={members.filter(syncing).length}
                                of={members.length}
                                disabled={setSync.isPending}
                                onChange={(on) => syncTo(ids, on)}
                              />
                              {folder && (
                                <>
                                  <Link to="/presets/new" search={{ folder }} className="text-sky-400 hover:text-sky-300">
                                    + New preset
                                  </Link>
                                  <button type="button" onClick={() => setRenaming(folder)} className="text-neutral-400 hover:text-neutral-200">
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveTo(ids, null)}
                                    title="Keeps the presets, outside any group"
                                    className="text-neutral-500 hover:text-red-400"
                                  >
                                    Ungroup
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {open &&
                      members.map((p) => {
                        const used = presetPaletteIds(p);
                        const usedPalettes = palettes.filter((x) => used.includes(x.id));
                        const targets = controllers.filter((c) => !presetSkipReason(p, c, controllers));
                        return (
                          <tr
                            key={p.id}
                            draggable
                            onDragStart={(e) => {
                              // Dragging a selected preset takes the whole selection along.
                              const dragged = selected.has(p.id) ? selectedIds : [p.id];
                              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragged));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            className={`hover:bg-neutral-900/60 ${selected.has(p.id) ? "bg-sky-950/30" : ""}`}
                          >
                            <td className="py-2 pl-4">
                              <input
                                type="checkbox"
                                aria-label={`Select ${p.name}`}
                                checked={selected.has(p.id)}
                                onChange={(e) => select([p.id], e.target.checked)}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <SyncSwitch on={syncing(p) ? 1 : 0} of={1} disabled={setSync.isPending} onChange={(on) => syncTo([p.id], on)} label={p.name} />
                            </td>
                            <td className="px-4 py-2 text-neutral-400">{p.slot}</td>
                            <td className="px-4 py-2">
                              <Link
                                to="/presets/$id"
                                params={{ id: p.id }}
                                className={`font-medium hover:underline ${syncing(p) ? "text-sky-400" : "text-sky-400/60"}`}
                              >
                                {p.name}
                              </Link>
                              {!syncing(p) && (
                                <span className="ml-2 rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400" title="Sync is off: kept in the app, removed from controllers at the next sync">
                                  app only
                                </span>
                              )}
                              {p.ql && <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs">{p.ql}</span>}
                            </td>
                            <td className="px-4 py-2 text-neutral-400">
                              {p.kind === "state"
                                ? `${realSegments(p).length} segment${realSegments(p).length === 1 ? "" : "s"}: ${effectNames(p, catalog?.effects ?? []).join(", ") || "no effect set"}`
                                : rawKind(p.raw)}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex gap-1">
                                {usedPalettes.map((x) => (
                                  <span key={x.id} title={x.name} className="h-3 w-10 rounded" style={{ background: stopsToCss(x.stops) }} />
                                ))}
                              </div>
                            </td>
                            {controllers.length > 1 && (
                              <td className={`px-4 py-2 text-xs ${targets.length || !syncing(p) ? "text-neutral-400" : "text-amber-400"}`}>
                                {!syncing(p) ? "Off" : targets.length === controllers.length ? "All" : targets.map((c) => c.name).join(", ") || "None"}
                              </td>
                            )}
                            <td className="px-4 py-2 text-right">
                              <Link
                                to="/presets/new"
                                search={{ from: p.id }}
                                className="text-xs text-sky-400 hover:text-sky-300"
                                title="Start a new preset from a copy of this one"
                              >
                                Duplicate
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Switches syncing for one preset or several: on when all `of` are on, off when none are, half-way in between.
 * Clicking turns them all on, unless they all are.
 */
function SyncSwitch({
  on,
  of,
  disabled,
  onChange,
  label,
}: {
  on: number;
  of: number;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  /** The preset's name, for a single preset. */
  label?: string;
}) {
  const all = on === of;
  const mixed = on > 0 && !all;
  return (
    <span className="inline-flex items-center gap-2">
      {of > 1 && (
        <span className="text-neutral-500">
          {all ? "all syncing" : on === 0 ? "sync off" : `${on} of ${of} syncing`}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={mixed ? "mixed" : all}
        aria-label={label ? `Sync ${label}` : "Sync these presets"}
        title={all ? "Syncing to controllers. Click to keep in the app only." : "Not syncing. Click to sync to controllers."}
        disabled={disabled}
        onClick={() => onChange(!all)}
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          all ? "bg-sky-600" : mixed ? "bg-sky-900" : "bg-neutral-700"
        }`}
      >
        <span
          className={`inline-block size-3 rounded-full bg-white transition-transform ${all ? "translate-x-3.5" : mixed ? "translate-x-2" : "translate-x-0.5"}`}
        />
      </button>
    </span>
  );
}
