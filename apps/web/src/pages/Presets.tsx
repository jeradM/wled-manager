import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { presetPaletteIds, presetSkipReason, stopsToCss, type Preset } from "@wled-manager/shared";
import { useCatalog, useControllers, useMovePresets, usePalettes, usePresets } from "../queries";
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
  const columns = 5 + (controllers.length > 1 ? 1 : 0);

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
      <ErrorText error={move.error} />
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
                <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-neutral-400 hover:text-neutral-200">
                  Clear selection
                </button>
              </>
            ) : (
              <span className="text-xs text-neutral-500">
                Select presets to put them in a group, or drag them onto one. Groups only organize this list; controllers
                never see them.
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
                  <th className="w-14 px-4 py-2 font-medium">Slot</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Contents</th>
                  <th className="px-4 py-2 font-medium">Palettes</th>
                  {controllers.length > 1 && <th className="px-4 py-2 font-medium">Syncs to</th>}
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
                            {folder && (
                              <div className="ml-auto flex shrink-0 items-center gap-3 pr-2 text-xs">
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
                              </div>
                            )}
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
                            <td className="px-4 py-2 text-neutral-400">{p.slot}</td>
                            <td className="px-4 py-2">
                              <Link to="/presets/$id" params={{ id: p.id }} className="font-medium text-sky-400 hover:underline">
                                {p.name}
                              </Link>
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
                              <td className={`px-4 py-2 text-xs ${targets.length ? "text-neutral-400" : "text-amber-400"}`}>
                                {targets.length === controllers.length ? "All" : targets.map((c) => c.name).join(", ") || "None"}
                              </td>
                            )}
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
