import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { indicesToSpans, type LedLayout, type LedMarker, type LedRange, type LedSpan } from "@wled-manager/shared";
import { useController, useUpdateController } from "../queries";
import { LedMap } from "../components/locator/LedMap";
import { useLocator } from "../components/locator/useLocator";
import { Button, Card, ErrorText, PageHeader } from "../components/ui";

const COLORS = ["#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ff00ff"];

/** "10–39, 50" for a list of runs. */
const describeSpans = (spans: LedSpan[]) =>
  spans.map((s) => (s.stop - s.start > 1 ? `${s.start}–${s.stop - 1}` : `${s.start}`)).join(", ");

export function Locator() {
  const { id } = useParams({ from: "/controllers/$id/locate" });
  const { data: c } = useController(id);
  const update = useUpdateController(id);
  const loc = useLocator(id);
  const [color, setColorState] = useState(COLORS[0]!);
  const [jump, setJump] = useState("");
  const [label, setLabel] = useState("");

  const count = c?.device?.ledCount ?? 0;
  const layout = c?.layout;
  const markers = c?.markers ?? [];
  const ranges = c?.ranges ?? [];
  const spans = useMemo(() => indicesToSpans(loc.selection), [loc.selection]);
  const multiple = loc.selection.size > 1;

  const step = (delta: number) => {
    if (!count) return;
    const from = loc.index ?? (delta > 0 ? -1 : count);
    loc.select(Math.min(count - 1, Math.max(0, from + delta)));
  };

  // Arrow keys step through LEDs (Shift: by 10), Home/End jump to the ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const n = e.shiftKey ? 10 : 1;
      const moves: Record<string, () => void> = {
        ArrowRight: () => step(n),
        ArrowDown: () => step(n),
        ArrowLeft: () => step(-n),
        ArrowUp: () => step(-n),
        Home: () => loc.select(0),
        End: () => loc.select(count - 1),
        Escape: () => loc.clear(),
      };
      if (moves[e.key]) {
        e.preventDefault();
        moves[e.key]!();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setLayout = (patch: Partial<LedLayout>) => layout && update.mutate({ layout: { ...layout, ...patch } });
  const setMarkers = (next: LedMarker[]) => update.mutate({ markers: next });
  const setRanges = (next: LedRange[]) => update.mutate({ ranges: next });

  // One selected LED is labelled as a marker; several as a range (replacing a range with the same label).
  const addLabel = (e: FormEvent) => {
    e.preventDefault();
    const text = label.trim();
    if (!text || !spans.length) return;
    if (multiple) setRanges([...ranges.filter((r) => r.label !== text), { label: text, spans }]);
    else setMarkers([...markers.filter((m) => m.index !== spans[0]!.start), { index: spans[0]!.start, label: text }]);
    setLabel("");
  };


  if (!c) return null;
  if (!c.device || c.status !== "online")
    return (
      <div>
        <PageHeader title={`Locate LEDs · ${c.name}`} />
        <Card><p className="text-sm text-neutral-400">The controller must be online to locate LEDs.</p></Card>
      </div>
    );

  const marker = markers.find((m) => m.index === loc.index);

  return (
    <div>
      <PageHeader
        title={`Locate LEDs · ${c.name}`}
        actions={
          <>
            <Link to="/controllers/$id" params={{ id }}><Button>Back</Button></Link>
            <Button variant="primary" onClick={() => loc.stop()} disabled={!loc.active}>
              Done – restore lights
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-40">
            <div className="text-xs text-neutral-500">{loc.active ? "Lit on the controller" : "Click an LED to start"}</div>
            <div className="text-2xl font-semibold tabular-nums">
              {multiple ? `${loc.selection.size} LEDs` : loc.index === null ? "–" : `LED ${loc.index}`}
              <span className="ml-2 text-sm font-normal text-neutral-500">of {count}</span>
            </div>
            <div className="h-4 max-w-72 truncate text-xs text-amber-400">
              {multiple ? describeSpans(spans) : marker?.label}
            </div>
          </div>
          <div className="flex gap-1">
            <Button onClick={() => step(-10)} title="Back 10 (Shift+←)">−10</Button>
            <Button onClick={() => step(-1)} title="Back 1 (←)">‹ Prev</Button>
            <Button onClick={() => step(1)} title="Forward 1 (→)">Next ›</Button>
            <Button onClick={() => step(10)} title="Forward 10 (Shift+→)">+10</Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (Number.isInteger(n) && n >= 0 && n < count) loc.select(n);
            }}
            className="flex gap-1"
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder="Go to #"
              inputMode="numeric"
              className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
            <Button type="submit">Go</Button>
          </form>
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Highlight color">
            {COLORS.map((col) => (
              <button
                key={col}
                type="button"
                aria-label={col}
                onClick={() => {
                  setColorState(col);
                  loc.setColor(col);
                }}
                className={`size-6 rounded-full border-2 ${color === col ? "border-sky-400" : "border-neutral-700"}`}
                style={{ background: col }}
              />
            ))}
          </div>
          <span className="text-xs text-neutral-500">{loc.busy ? "Sending…" : "← → to step, Shift for 10, Esc to clear"}</span>
        </div>
        <ErrorText error={loc.error} />
        {loc.active && (
          <p className="mt-2 text-xs text-neutral-500">
            The controller's normal lighting is paused. Press Done, leave this page, or wait 10 minutes to restore it.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          <LedMap
            count={count}
            layout={layout!}
            markers={markers}
            ranges={ranges}
            current={loc.index}
            selected={loc.selection}
            color={color}
            onSelect={loc.select}
          />
          <p className="mt-2 text-xs text-neutral-500">
            Click an LED to light it. Shift-click selects the run from the last click; Ctrl/⌘-click adds or removes one
            LED; Ctrl/⌘-Shift-click adds a run.
          </p>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 text-sm">
            <h2 className="font-medium">Layout</h2>
            <select
              value={layout!.type}
              onChange={(e) => setLayout({ type: e.target.value as LedLayout["type"] })}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            >
              <option value="strip">Strip (wrapped into rows)</option>
              <option value="grid">Grid / matrix</option>
              <option value="ring">Ring</option>
            </select>
            {layout!.type !== "ring" && (
              <label className="flex items-center justify-between gap-2">
                <span className="text-neutral-400">LEDs per row</span>
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={layout!.columns}
                  onChange={(e) => setLayout({ columns: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                />
              </label>
            )}
            {layout!.type === "grid" && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={layout!.serpentine} onChange={(e) => setLayout({ serpentine: e.target.checked })} />
                Zig-zag wiring (serpentine)
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={layout!.reverse} onChange={(e) => setLayout({ reverse: e.target.checked })} />
              Start from the other end
            </label>
          </Card>

          <Card className="flex flex-col gap-3 text-sm">
            <h2 className="font-medium">Labels</h2>
            <form onSubmit={addLabel} className="flex gap-1">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  !spans.length ? "Select LEDs first" : multiple ? `Name these ${loc.selection.size} LEDs` : `Label for LED ${spans[0]!.start}`
                }
                disabled={!spans.length}
                maxLength={40}
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              />
              <Button type="submit" disabled={!spans.length || !label.trim()}>{multiple ? "Save range" : "Mark"}</Button>
            </form>
            <p className="text-xs text-neutral-500">
              One LED becomes a marker; several become a range. Ranges and markers can be used to build segments.
            </p>
            {ranges.length > 0 && (
              <>
                <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">Ranges</h3>
                <ul className="flex flex-col divide-y divide-neutral-800">
                  {ranges.map((r) => (
                    <li key={r.label} className="flex items-center justify-between gap-2 py-1">
                      <button type="button" onClick={() => loc.selectSpans(r.spans)} className="min-w-0 text-left hover:text-sky-400">
                        <span className="block truncate">{r.label}</span>
                        <span className="text-xs text-neutral-500">LEDs {describeSpans(r.spans)}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove range ${r.label}`}
                        onClick={() => setRanges(ranges.filter((x) => x.label !== r.label))}
                        className="text-neutral-500 hover:text-red-400"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {markers.length > 0 && (
              <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">Markers</h3>
            )}
            {markers.length > 0 && (
              <ul className="flex flex-col divide-y divide-neutral-800">
                {markers.map((m) => (
                  <li key={m.index} className="flex items-center justify-between gap-2 py-1">
                    <button type="button" onClick={() => loc.select(m.index)} className="min-w-0 text-left hover:text-sky-400">
                      <span className="block truncate">{m.label}</span>
                      <span className="text-xs text-neutral-500">LED {m.index}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove marker ${m.label}`}
                      onClick={() => setMarkers(markers.filter((x) => x.index !== m.index))}
                      className="text-neutral-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
