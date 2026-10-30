import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { canonicalJson, layoutStrips, lineFirstLeds, type Controller, type LayoutLine, type LayoutPoint } from "@wled-manager/shared";
import { layoutImageUrl, useControllers, useDeleteLayout, useLayout, useLayouts, useWriteLayout } from "../queries";
import { LayoutCanvas, UNASSIGNED_COLOR, controllerColor, type LayoutTool } from "../components/layout/LayoutCanvas";
import { Button, Card, ErrorText, Input, PageHeader } from "../components/ui";

const BLANK_ASPECT = 9 / 16;
const DEFAULT_LED_SIZE = 8;

/** Line colors by controller: each controller its own, unassigned lines gray. */
function useColors(controllers: Controller[]) {
  return useMemo(() => {
    const index = new Map(controllers.map((c, i) => [c.id, i]));
    return (id: string | null) => (id === null ? UNASSIGNED_COLOR : controllerColor(index.get(id) ?? -1));
  }, [controllers]);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function Layouts() {
  const { data: layouts = [], isLoading } = useLayouts();
  const { data: controllers = [] } = useControllers();
  const colorOf = useColors(controllers);
  return (
    <div>
      <PageHeader
        title="Layouts"
        actions={
          <Link to="/layouts/new">
            <Button variant="primary">New layout</Button>
          </Link>
        }
      />
      {!isLoading && layouts.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No layouts yet. A layout is a picture of your lights (your house, a tree…) with the light runs drawn on it as lines. Pick one
            in the simulator or the layered effects editor to see effects where the lights really are.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map((l) => {
            const lights = l.lines.reduce((n, x) => n + x.count, 0);
            return (
              <Link key={l.id} to="/layouts/$id" params={{ id: l.id }}>
                <Card className="transition-colors hover:border-neutral-600">
                  <LayoutCanvas
                    lines={l.lines}
                    imageUrl={l.image ? layoutImageUrl(l) : null}
                    aspect={l.image ? l.image.height / l.image.width : BLANK_ASPECT}
                    ledSize={Math.max(2, Math.round(l.ledSize / 2))}
                    colorOf={colorOf}
                  />
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="font-medium">{l.name}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {plural(lights, "light")} · {plural(l.lines.length, "line")}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NewLayout() {
  return <LayoutDesigner />;
}

export function EditLayout() {
  const { id } = useParams({ from: "/layouts/$id" });
  return <LayoutDesigner id={id} />;
}

/** A picture chosen here but not uploaded yet. */
type PendingImage = { file: File; url: string; width: number; height: number };

const newId = () => Math.random().toString(36).slice(2, 10);

function LayoutDesigner({ id }: { id?: string }) {
  const { data: existing, error: loadError } = useLayout(id);
  const { data: controllers = [] } = useControllers();
  const write = useWriteLayout();
  const del = useDeleteLayout();
  const navigate = useNavigate();
  const colorOf = useColors(controllers);

  const [name, setName] = useState("");
  const [lines, setLines] = useState<LayoutLine[]>([]);
  const [ledSize, setLedSize] = useState(DEFAULT_LED_SIZE);
  // undefined: keep the saved picture; null: remove it; otherwise a newly chosen one.
  const [image, setImage] = useState<PendingImage | null | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(id ? null : canonicalJson({ name: "", lines: [], ledSize: DEFAULT_LED_SIZE }));
  const [tool, setTool] = useState<LayoutTool>("draw");
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setLines(existing.lines);
    setLedSize(existing.ledSize);
    setSaved(canonicalJson({ name: existing.name, lines: existing.lines, ledSize: existing.ledSize }));
    setTool(existing.lines.length ? "select" : "draw");
  }, [existing]);

  const dirty = (saved !== null && canonicalJson({ name, lines, ledSize }) !== saved) || image !== undefined;
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  const sel = lines.find((l) => l.id === selected);
  const setLine = (lineId: string, patch: Partial<LayoutLine>) => setLines(lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  const removeLine = (lineId: string) => {
    setLines(lines.filter((l) => l.id !== lineId));
    if (selected === lineId) setSelected(null);
  };
  /** Moves line `from` to position `to`. */
  const moveLine = (from: number, to: number) => {
    const next = [...lines];
    next.splice(to, 0, ...next.splice(from, 1));
    setLines(next);
  };
  // Dragging a line in the list: where from, and the line it's over.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  // Delete removes the selected line (unless typing in a field).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeLine(selected);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  /** A drawn line: on the controller of the line selected or drawn last, with lights about two sizes apart. */
  const addLine = (from: LayoutPoint, to: LayoutPoint, pixels: number) => {
    const controllerId = sel?.controllerId ?? lines[lines.length - 1]?.controllerId ?? controllers[0]?.id ?? null;
    const line: LayoutLine = { id: newId(), controllerId, from, to, count: Math.max(2, Math.round(pixels / (ledSize * 2)) + 1) };
    setLines([...lines, line]);
    setSelected(line.id);
  };

  const chooseImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
  };

  const imageUrl = image ? image.url : image === null ? null : existing?.image ? layoutImageUrl(existing) : null;
  const size = image ?? (image === null ? null : existing?.image) ?? null;
  const aspect = size ? size.height / size.width : BLANK_ASPECT;

  const firsts = lineFirstLeds(lines);
  const strips = layoutStrips({ lines });
  const controllerName = (cid: string | null) => (cid === null ? "Unassigned" : (controllers.find((c) => c.id === cid)?.name ?? "Removed controller"));

  if (loadError) return <ErrorText error={loadError} />;
  if (id && !existing) return null;

  const save = () =>
    write.mutate(
      {
        id,
        input: { name: name.trim(), lines, ledSize },
        ...(image !== undefined ? { image: image && { file: image.file, width: image.width, height: image.height } } : {}),
      },
      {
        onSuccess: (l) => {
          setSaved(canonicalJson({ name: l.name, lines: l.lines, ledSize: l.ledSize }));
          setImage(undefined);
          if (!id) void navigate({ to: "/layouts/$id", params: { id: l.id } });
        },
      },
    );
  const remove = () => {
    if (!id || !confirm(`Delete layout "${existing?.name}"?`)) return;
    del.mutate(id, { onSuccess: () => void navigate({ to: "/layouts" }) });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? `Edit ${existing?.name ?? "layout"}` : "New layout"}
        actions={
          <>
            {id && (
              <Button variant="danger" onClick={remove} disabled={del.isPending}>
                Delete
              </Button>
            )}
            <Button onClick={() => void navigate({ to: "/layouts" })}>{dirty ? "Cancel" : "Back"}</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || !dirty || write.isPending}>
              Save
            </Button>
          </>
        }
      />
      <ErrorText error={write.error ?? del.error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <div className="min-w-56 flex-1">
                <Input label="Name" value={name} maxLength={64} autoFocus={!id} onChange={(e) => setName(e.target.value)} />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) chooseImage(f);
                  e.target.value = "";
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>{imageUrl ? "Change picture…" : "Choose picture…"}</Button>
              {imageUrl && (
                <Button onClick={() => setImage(null)} title="Draw on a blank canvas instead">
                  Remove picture
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex overflow-hidden rounded-md border border-neutral-700" role="radiogroup" aria-label="Tool">
                {(["draw", "select"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={tool === t}
                    onClick={() => setTool(t)}
                    className={`px-3 py-1 ${tool === t ? "bg-sky-700 text-white" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"}`}
                  >
                    {t === "draw" ? "Draw lines" : "Select & move"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-neutral-500">
                {tool === "draw"
                  ? "Click the first light, then the last. Shift keeps the line straight (45° steps); Esc cancels. Pinch or Ctrl/⌘ + scroll to zoom; scroll or Space + drag to pan."
                  : "Click a line to edit it. Drag a line to move it, or drag either end to re-aim it. Delete removes it. Pinch or Ctrl/⌘ + scroll to zoom; drag empty space to pan."}
              </span>
              <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
                Light size
                <input type="range" min={2} max={40} value={ledSize} onChange={(e) => setLedSize(Number(e.target.value))} className="accent-sky-500" />
              </label>
            </div>
          </Card>
          <LayoutCanvas
            lines={lines}
            imageUrl={imageUrl}
            aspect={aspect}
            ledSize={ledSize}
            colorOf={colorOf}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            onChange={setLines}
            onDraw={addLine}
          />
        </div>

        <div className="space-y-3">
          {sel && (
            <Card className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Line {lines.indexOf(sel) + 1}</h2>
                <button type="button" onClick={() => removeLine(sel.id)} className="text-xs text-red-400 hover:text-red-300">
                  Delete line
                </button>
              </div>
              <Input label="Name" value={sel.name ?? ""} maxLength={40} placeholder="e.g. Roof left" onChange={(e) => setLine(sel.id, { name: e.target.value || undefined })} />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Controller</span>
                <select
                  value={sel.controllerId ?? ""}
                  onChange={(e) => setLine(sel.id, { controllerId: e.target.value || null })}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                >
                  {controllers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="">Unassigned</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1" title="0 makes the line a gap: drawn, but using no LED numbers">
                  <span className="text-xs text-neutral-400">Lights (0 = gap)</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={sel.count}
                    onChange={(e) => setLine(sel.id, { count: Math.min(2000, Math.max(0, Math.round(Number(e.target.value)) || 0)) })}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1" title="The LED number of the first light on its controller. Empty continues after the controller's previous line.">
                  <span className="text-xs text-neutral-400">First LED</span>
                  <input
                    type="number"
                    min={0}
                    max={65535}
                    value={sel.firstLed ?? ""}
                    placeholder={`auto (${firsts[lines.indexOf(sel)]})`}
                    onChange={(e) =>
                      setLine(sel.id, { firstLed: e.target.value.trim() === "" ? undefined : Math.min(65535, Math.max(0, Math.round(Number(e.target.value)) || 0)) })
                    }
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                  />
                </label>
              </div>
              <Button onClick={() => setLine(sel.id, { from: sel.to, to: sel.from })} title="Make the other end the first light">
                ⇄ Flip direction
              </Button>
              {sel.count > 0 && (
                <p className="text-xs text-neutral-500">
                  LEDs {firsts[lines.indexOf(sel)]}–{firsts[lines.indexOf(sel)]! + sel.count - 1} on {controllerName(sel.controllerId)}. The ringed
                  light is the first; the arrow points along the line.
                </p>
              )}
            </Card>
          )}

          <Card className="space-y-2 text-sm">
            <h2 className="font-medium">Lines</h2>
            {lines.length === 0 && <p className="text-xs text-neutral-500">None yet. Draw one on the picture.</p>}
            <ol className="space-y-1">
              {lines.map((l, k) => (
                <li
                  key={l.id}
                  data-line
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDragOver(k);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== k) moveLine(dragFrom, k);
                    endDrag();
                  }}
                  className={`rounded ${dragFrom === k ? "opacity-40" : ""} ${
                    dragFrom !== null && dragOver === k && dragFrom !== k ? (dragFrom < k ? "shadow-[0_2px_0_0_#0ea5e9]" : "shadow-[0_-2px_0_0_#0ea5e9]") : ""
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${l.id === selected ? "bg-sky-950/60" : "hover:bg-neutral-800/60"}`}
                  >
                    <span
                      role="button"
                      aria-label="Drag to reorder"
                      title="Drag to reorder"
                      draggable
                      onDragStart={(e) => {
                        setDragFrom(k);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(k));
                        // Show the whole row under the pointer, not just the handle.
                        const row = e.currentTarget.closest("[data-line]");
                        if (row) e.dataTransfer.setDragImage(row, 12, 10);
                      }}
                      onDragEnd={endDrag}
                      className="-mx-0.5 cursor-grab text-neutral-500 select-none hover:text-neutral-200 active:cursor-grabbing"
                    >
                      ⠿
                    </span>
                    <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: colorOf(l.controllerId) }} />
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(l.id);
                        setTool("select");
                      }}
                      className="min-w-0 flex-1 truncate text-left"
                    >
                      <span className="text-neutral-200">{l.name || `Line ${k + 1}`}</span>
                      <span className="text-neutral-500">
                        {" "}
                        · {l.count === 0 ? "gap" : `${firsts[k]}–${firsts[k]! + l.count - 1}`}
                      </span>
                    </button>
                    <button type="button" onClick={() => moveLine(k, k - 1)} disabled={k === 0} className="px-0.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30" aria-label={`Move line ${k + 1} up`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLine(k, k + 1)}
                      disabled={k === lines.length - 1}
                      className="px-0.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                      aria-label={`Move line ${k + 1} down`}
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {lines.length > 1 && <p className="text-xs text-neutral-500">Order matters: a line without a first LED continues its controller's numbering from the line before it.</p>}
          </Card>

          {strips.length > 0 && (
            <Card className="space-y-1.5 text-sm">
              <h2 className="font-medium">Controllers</h2>
              {strips.map((s) => {
                const c = controllers.find((x) => x.id === s.controllerId);
                const over = c?.device && s.ledCount > c.device.ledCount;
                const used = new Set(s.lights.map((l) => l.line)).size;
                return (
                  <div key={s.controllerId ?? ""} className="text-xs">
                    <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: colorOf(s.controllerId) }} />
                    <span className="text-neutral-200">{controllerName(s.controllerId)}</span>
                    <span className="text-neutral-500">
                      : LEDs 0–{s.ledCount - 1} on {plural(used, "line")} ({plural(s.lights.length, "light")})
                    </span>
                    {over && <p className="text-amber-400">More than the {c!.device!.ledCount} LEDs this controller has.</p>}
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
