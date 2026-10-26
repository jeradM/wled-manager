import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { Controller } from "@wled-manager/shared";
import {
  useController,
  useDeleteController,
  useDevicePresets,
  useDeviceState,
  useQuickControl,
  useRefreshController,
  useUpdateController,
} from "../queries";
import { Button, Card, ErrorText, Input, PageHeader, StatusDot, timeAgo } from "../components/ui";

export function ControllerDetail() {
  const { id } = useParams({ from: "/controllers/$id" });
  const { data: c, error } = useController(id);
  const refresh = useRefreshController();
  const del = useDeleteController();
  const navigate = useNavigate();

  if (error) return <ErrorText error={error} />;
  if (!c) return null;

  const remove = () => {
    if (confirm(`Remove ${c.name} from WLED Manager? Nothing on the device is changed.`))
      del.mutate(c.id, { onSuccess: () => navigate({ to: "/controllers" }) });
  };

  return (
    <div>
      <PageHeader
        title={c.name}
        actions={
          <>
            <Button onClick={() => refresh.mutate(c.id)} disabled={refresh.isPending}>
              {refresh.isPending ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="danger" onClick={remove}>Remove</Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeviceInfo c={c} />
        {c.status === "online" ? <QuickControls id={c.id} /> : <Card><p className="text-sm text-neutral-400">Controls are available when the controller is online.</p></Card>}
        <Settings c={c} />
      </div>
    </div>
  );
}

function DeviceInfo({ c }: { c: Controller }) {
  const rows: [string, string][] = [
    ["Address", `http://${c.host}${c.port !== 80 ? `:${c.port}` : ""}`],
    ["Firmware", c.device?.version ?? "–"],
    ["Hardware", [c.device?.product, c.device?.arch].filter(Boolean).join(" · ") || "–"],
    ["MAC", c.device?.mac ?? "–"],
    ["LEDs", c.device ? `${c.device.ledCount}${c.device.rgbw ? " (RGBW)" : ""}` : "–"],
    ["Effects", c.device ? String(c.device.effectCount) : "–"],
    ["Custom palettes", c.device ? `${c.device.customPaletteCount} of ${c.device.customPaletteMax} slots used` : "–"],
    ["Last seen", timeAgo(c.lastSeen)],
  ];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Device</h2>
        <StatusDot status={c.status} />
      </div>
      {c.lastError && <p className="mb-3 rounded bg-red-950/50 px-2 py-1 text-xs text-red-300">{c.lastError}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function QuickControls({ id }: { id: string }) {
  const { data: state } = useDeviceState(id, true);
  const { data: presets = [] } = useDevicePresets(id, true);
  const control = useQuickControl(id);
  const [bri, setBri] = useState<number | null>(null);

  // Track the device's brightness unless the user is mid-drag.
  useEffect(() => {
    if (state && !control.isPending) setBri(null);
  }, [state, control.isPending]);

  if (!state) return <Card><p className="text-sm text-neutral-400">Loading state…</p></Card>;
  const shownBri = bri ?? state.bri;

  return (
    <Card>
      <h2 className="mb-3 font-medium">Quick controls</h2>
      <div className="flex flex-col gap-4 text-sm">
        <label className="flex items-center justify-between">
          <span className="text-neutral-400">Power</span>
          <Button variant={state.on ? "primary" : "secondary"} onClick={() => control.mutate({ on: !state.on })}>
            {state.on ? "On" : "Off"}
          </Button>
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex justify-between text-neutral-400">
            Brightness <span>{Math.round((shownBri / 255) * 100)}%</span>
          </span>
          <input
            type="range"
            min={1}
            max={255}
            value={shownBri}
            onChange={(e) => setBri(Number(e.target.value))}
            onPointerUp={() => bri !== null && control.mutate({ bri })}
            onKeyUp={() => bri !== null && control.mutate({ bri })}
            className="accent-sky-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">Apply preset from device</span>
          <select
            value={state.ps > 0 ? state.ps : ""}
            onChange={(e) => control.mutate({ ps: Number(e.target.value) })}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5"
          >
            <option value="" disabled>Choose a preset…</option>
            {presets.map((p) => (
              <option key={p.slot} value={p.slot}>{p.slot}. {p.name}</option>
            ))}
          </select>
        </label>
        <ErrorText error={control.error} />
      </div>
    </Card>
  );
}

function Settings({ c }: { c: Controller }) {
  const update = useUpdateController(c.id);
  const [name, setName] = useState(c.name);
  const [host, setHost] = useState(c.host);
  const [port, setPort] = useState(String(c.port));
  const [tags, setTags] = useState(c.tags.join(", "));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 80,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  };

  return (
    <Card>
      <h2 className="mb-3 font-medium">Settings</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Input label="IP or hostname" value={host} onChange={(e) => setHost(e.target.value)} required />
          <Input label="Port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
        </div>
        <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        <ErrorText error={update.error} />
        <div>
          <Button variant="primary" type="submit" disabled={update.isPending}>Save</Button>
        </div>
      </form>
    </Card>
  );
}
