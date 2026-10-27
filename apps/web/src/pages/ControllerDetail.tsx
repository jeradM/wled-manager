import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { Controller } from "@wled-manager/shared";
import {
  useController,
  useDeleteController,
  useDevicePresets,
  useDeviceState,
  useQuickControl,
  useRefreshController,
  useReplaceSetup,
  useUpdateController,
} from "../queries";
import { readControllerFile, setupSummary } from "../controllerFile";
import { ImportPanel } from "../components/ImportPanel";
import { SyncCard } from "../components/SyncCard";
import { Button, Card, ErrorText, FileButton, Input, PageHeader, StatusDot, timeAgo } from "../components/ui";

export function ControllerDetail() {
  const { id } = useParams({ from: "/controllers/$id" });
  const { data: c, error } = useController(id);
  const refresh = useRefreshController();
  const del = useDeleteController();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);

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
            <Link to="/controllers/$id/locate" params={{ id: c.id }}>
              <Button disabled={c.status !== "online"}>Locate LEDs</Button>
            </Link>
            <Link to="/controllers/$id/segments" params={{ id: c.id }}>
              <Button>Segments</Button>
            </Link>
            <Button onClick={() => setImporting(true)} disabled={importing || c.status !== "online"}>
              Import from controller
            </Button>
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
        {importing && <ImportPanel controllerId={c.id} onClose={() => setImporting(false)} />}
        <SyncCard controllerId={c.id} online={c.status === "online"} />
        <Settings c={c} />
        <SetupFile c={c} />
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

function SetupFile({ c }: { c: Controller }) {
  const replace = useReplaceSetup(c.id);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const replaceFrom = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const imported = await readControllerFile(file);
      const from = imported.controller;
      const ledCount = c.device?.ledCount;
      const wiring =
        from.ledCount !== null && ledCount !== undefined && from.ledCount !== ledCount
          ? `\n\n${from.name} had ${from.ledCount} LEDs; this controller has ${ledCount}.`
          : "";
      const message =
        `Replace ${c.name}'s LED layout and ${setupSummary(c)} with ${from.name}'s ${setupSummary(from)}?` +
        ` Its name, address and tags stay as they are.${wiring}`;
      if (!confirm(message)) return;
      await replace.mutateAsync(imported);
      setDone(`Replaced with ${from.name}'s setup.`);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Card>
      <h2 className="mb-1 font-medium">Setup file</h2>
      <p className="mb-3 text-sm text-neutral-400">
        Name, address, tags, LED layout, {setupSummary(c)}. Export them to bring this controller into another WLED
        Manager; presets keep using its segments there.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/controllers/${c.id}/export`}
          download
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-700"
        >
          Export
        </a>
        <FileButton accept=".json,application/json" onFile={replaceFrom} disabled={replace.isPending}>
          Replace from file…
        </FileButton>
        {done && <span className="text-sm text-emerald-400">{done}</span>}
      </div>
      <div className="mt-2">
        <ErrorText error={error} />
      </div>
    </Card>
  );
}
