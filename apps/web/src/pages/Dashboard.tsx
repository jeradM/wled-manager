import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Controller, QuickControl } from "@wled-manager/shared";
import { useControllers, useDevicesLive, useQuickControls, type DevicePreset, type DeviceState } from "../queries";
import { Button, Card, ErrorText, PageHeader, StatusDot, timeAgo } from "../components/ui";

type Live = ReturnType<typeof useDevicesLive>[number];
type Send = ReturnType<typeof useQuickControls>;

const percent = (bri: number) => `${Math.round((bri / 255) * 100)}%`;
const selectClass = "w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm";

export function Dashboard() {
  const { data: controllers = [], isLoading } = useControllers();
  const online = controllers.filter((c) => c.status === "online");
  const live = useDevicesLive(online.map((c) => c.id));
  const liveOf = (id: string) => live.find((l) => l.id === id);
  const send = useQuickControls();
  // Controllers ticked for controlling together; offline ones drop out.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selected = online.filter((c) => picked.has(c.id));
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allPicked = online.length > 0 && selected.length === online.length;

  return (
    <div>
      <PageHeader title="Dashboard" />
      {!isLoading && controllers.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No controllers yet.{" "}
            <Link to="/controllers" className="text-sky-400 hover:underline">
              Add your first WLED controller
            </Link>
            .
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-400">
            <p>
              {online.length} of {controllers.length} controllers online
            </p>
            {online.length > 1 && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && !allPicked;
                  }}
                  onChange={() => setPicked(new Set(allPicked ? [] : online.map((c) => c.id)))}
                />
                Select all online
              </label>
            )}
          </div>
          {selected.length > 0 && (
            <GroupControls controllers={selected} live={selected.map((c) => liveOf(c.id)!)} send={send} onClear={() => setPicked(new Set())} />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {controllers.map((c) => (
              <ControllerCard
                key={c.id}
                controller={c}
                live={liveOf(c.id)}
                send={send}
                picked={picked.has(c.id)}
                onPick={online.length > 1 ? (on) => toggle(c.id, on) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ControllerCard({
  controller: c,
  live,
  send,
  picked,
  onPick,
}: {
  controller: Controller;
  live: Live | undefined;
  send: Send;
  picked: boolean;
  /** Ticks the controller for controlling together with others; absent when there's no one to group with. */
  onPick?: (on: boolean) => void;
}) {
  const isOnline = c.status === "online";
  return (
    <Card className={`flex h-full flex-col transition-colors ${picked ? "border-sky-700" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {onPick && isOnline && (
            <input
              type="checkbox"
              checked={picked}
              onChange={(e) => onPick(e.target.checked)}
              className="mt-1"
              aria-label={`Select ${c.name} to control with others`}
            />
          )}
          <div className="min-w-0">
            <Link to="/controllers/$id" params={{ id: c.id }} className="font-medium hover:text-sky-300 hover:underline">
              {c.name}
            </Link>
            <div className="text-xs text-neutral-500">
              {c.host}
              {c.port !== 80 && `:${c.port}`}
            </div>
          </div>
        </div>
        <StatusDot status={c.status} />
      </div>
      {isOnline && <CardControls id={c.id} name={c.name} live={live} send={send} />}
      {c.device && (
        <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">Firmware</dt>
          <dd>{c.device.version}</dd>
          <dt className="text-neutral-500">LEDs</dt>
          <dd>
            {c.device.ledCount}
            {c.device.rgbw && " RGBW"}
          </dd>
          <dt className="text-neutral-500">Custom palettes</dt>
          <dd>
            {c.device.customPaletteCount} / {c.device.customPaletteMax}
          </dd>
        </dl>
      )}
      <div className="mt-auto pt-3 text-xs text-neutral-500">
        {c.status === "offline" ? `Last seen ${timeAgo(c.lastSeen)}` : `Seen ${timeAgo(c.lastSeen)}`}
      </div>
    </Card>
  );
}

/** One controller's power, brightness and preset. */
function CardControls({ id, name, live, send }: { id: string; name: string; live: Live | undefined; send: Send }) {
  const [error, setError] = useState<unknown>(null);
  const control = (body: QuickControl) =>
    send.mutate([{ id, body }], { onSuccess: (failed) => setError(failed[0]?.error ?? null), onError: setError });
  const state = live?.state;
  if (!state) return <p className="mt-4 text-xs text-neutral-500">{live?.error ? "Couldn't read the lights." : "Reading the lights…"}</p>;
  return (
    <div className="mt-4 flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-3">
        <PowerSwitch on={state.on} label={`${name} power`} onChange={(on) => control({ on })} />
        <Brightness value={state.bri} label={`${name} brightness`} onCommit={(bri) => control({ bri })} />
      </div>
      <PresetSelect state={state} presets={live?.presets ?? []} label={`${name} preset`} onChoose={(ps) => control({ ps })} />
      <ErrorText error={error} />
    </div>
  );
}

/** Power, brightness and preset for several controllers at once. */
function GroupControls({ controllers, live, send, onClear }: { controllers: Controller[]; live: (Live | undefined)[]; send: Send; onClear: () => void }) {
  const [failed, setFailed] = useState<string[]>([]);
  const states = live.map((l) => l?.state);
  const onCount = states.filter((s) => s?.on).length;
  const known = states.filter((s): s is DeviceState => !!s);
  const avgBri = known.length ? Math.round(known.reduce((n, s) => n + s.bri, 0) / known.length) : 128;
  const mixedBri = known.some((s) => s.bri !== known[0]!.bri);

  // A preset is picked by name, as each controller may keep it in a different slot.
  const byName = new Map<string, { id: string; slot: number }[]>();
  controllers.forEach((c, i) => {
    for (const p of live[i]?.presets ?? []) byName.set(p.name, [...(byName.get(p.name) ?? []), { id: c.id, slot: p.slot }]);
  });
  const presetNames = [...byName.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const control = (sends: { id: string; body: QuickControl }[]) =>
    send.mutate(sends, {
      onSuccess: (f) => setFailed(f.map((x) => controllers.find((c) => c.id === x.id)?.name ?? x.id)),
      onError: () => setFailed(controllers.map((c) => c.name)),
    });
  const all = (body: QuickControl) => control(controllers.map((c) => ({ id: c.id, body })));
  const n = controllers.length;

  return (
    <Card className="sticky top-0 z-20 mb-4 shadow-lg shadow-black/60">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">
            {n} controller{n === 1 ? "" : "s"} selected
          </div>
          <div className="truncate text-xs text-neutral-500">{controllers.map((c) => c.name).join(", ")}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">{onCount === n ? "All on" : onCount === 0 ? "All off" : `${onCount} of ${n} on`}</span>
          <Button onClick={() => all({ on: true })} disabled={send.isPending || onCount === n}>
            On
          </Button>
          <Button onClick={() => all({ on: false })} disabled={send.isPending || onCount === 0}>
            Off
          </Button>
        </div>
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <Brightness value={avgBri} mixed={mixedBri} label="Brightness for the selected controllers" onCommit={(bri) => all({ bri })} />
        </div>
        <select
          value=""
          onChange={(e) => {
            const targets = byName.get(e.target.value) ?? [];
            control(targets.map((t) => ({ id: t.id, body: { ps: t.slot } })));
          }}
          className={`${selectClass} max-w-64`}
          aria-label="Preset for the selected controllers"
          disabled={!presetNames.length}
        >
          <option value="" disabled>
            {presetNames.length ? "Apply a preset…" : "No presets on these controllers"}
          </option>
          {presetNames.map(([name, on]) => (
            <option key={name} value={name}>
              {name}
              {on.length < n ? ` (on ${on.length} of ${n})` : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={onClear} className="ml-auto text-xs text-neutral-400 hover:text-neutral-200">
          Clear selection
        </button>
      </div>
      {failed.length > 0 && <p className="mt-2 text-xs text-red-400">Couldn't reach {failed.join(", ")}.</p>}
    </Card>
  );
}

function PowerSwitch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? "On: click to turn off" : "Off: click to turn on"}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-sky-600" : "bg-neutral-700"}`}
    >
      <span className={`inline-block size-4 rounded-full bg-white transition-transform ${on ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** A brightness slider that sends its value when let go, and otherwise follows the controller. */
function Brightness({ value, mixed, label, onCommit }: { value: number; mixed?: boolean; label: string; onCommit: (bri: number) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => setDragging(null), [value]);
  const commit = () => dragging !== null && onCommit(dragging);
  return (
    <>
      <input
        type="range"
        min={1}
        max={255}
        value={dragging ?? value}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-label={label}
        className="min-w-0 flex-1 accent-sky-500"
      />
      <span className="w-12 shrink-0 text-right text-xs text-neutral-400 tabular-nums">{dragging === null && mixed ? "mixed" : percent(dragging ?? value)}</span>
    </>
  );
}

function PresetSelect({ state, presets, label, onChoose }: { state: DeviceState; presets: DevicePreset[]; label: string; onChoose: (slot: number) => void }) {
  const current = presets.some((p) => p.slot === state.ps) ? state.ps : "";
  return (
    <select value={current} onChange={(e) => onChoose(Number(e.target.value))} className={selectClass} aria-label={label} disabled={!presets.length}>
      <option value="" disabled>
        {presets.length ? "Choose a preset…" : "No presets on this controller"}
      </option>
      {presets.map((p) => (
        <option key={p.slot} value={p.slot}>
          {p.slot}. {p.name}
        </option>
      ))}
    </select>
  );
}
