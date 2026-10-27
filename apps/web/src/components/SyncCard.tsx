import { useState } from "react";
import type { ChangeAction, SyncPlan } from "@wled-manager/shared";
import { usePalettes, useSync, useSyncPlan } from "../queries";
import { GradientSwatch } from "./GradientEditor";
import { Button, Card, ErrorText } from "./ui";

const actionStyle: Record<ChangeAction, string> = {
  create: "bg-emerald-950 text-emerald-300",
  update: "bg-amber-950 text-amber-300",
  delete: "bg-red-950 text-red-300",
  unchanged: "bg-neutral-800 text-neutral-400",
};

/** Shows what a sync would change on the controller and applies it on confirmation. */
export function SyncCard({ controllerId, online }: { controllerId: string; online: boolean }) {
  const { data: plan, error, isFetching, refetch } = useSyncPlan(controllerId, online);
  const { data: palettes = [] } = usePalettes();
  const sync = useSync();

  const foreignPalettes = plan?.palettes.filter((c) => c.replacesUnmanaged) ?? [];
  const foreignPresets = plan?.presets.filter((c) => c.replacesUnmanaged) ?? [];
  const foreign = [...foreignPalettes, ...foreignPresets];
  const deletions = [...(plan?.palettes ?? []), ...(plan?.presets ?? [])].filter((c) => c.action === "delete").length;
  const apply = () => {
    const message = foreign.length
      ? `These items on the controller weren't written by WLED Manager (or were changed since) and will be overwritten or removed:\n` +
        [
          ...foreignPalettes.map((c) => `  palette ${c.path}`),
          ...foreignPresets.map((c) => `  preset ${c.slot}: ${c.name}`),
        ].join("\n") +
        "\n\nImport them first if you want to keep them. Continue?"
      : deletions
        ? `This removes ${deletions} item(s) from the controller. Continue?`
        : null;
    if (message && !confirm(message)) return;
    sync.mutate(controllerId);
  };

  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Sync</h2>
        <div className="flex items-center gap-2">
          {plan && (
            <span className={`text-xs ${plan.inSync ? "text-emerald-400" : "text-amber-400"}`}>
              {plan.inSync ? "In sync" : "Changes pending"}
            </span>
          )}
          <Button onClick={() => refetch()} disabled={!online || isFetching}>
            {isFetching ? "Checking…" : "Re-check"}
          </Button>
          <Button variant="primary" onClick={apply} disabled={!plan || plan.inSync || sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>
      {!online && <p className="text-sm text-neutral-400">The controller must be online to compare.</p>}
      <ErrorText error={error ?? sync.error} />
      {foreign.length > 0 && (
        <p className="mb-2 rounded bg-red-950/50 px-2 py-1 text-xs text-red-300">
          {foreign.length} item(s) on this controller weren't written by WLED Manager. Syncing replaces them; import them first
          to keep them.
        </p>
      )}
      {plan?.warnings.map((w) => (
        <p key={w} className="mb-2 rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">{w}</p>
      ))}
      {plan && <h3 className="mt-2 mb-1 text-xs font-medium tracking-wide text-neutral-400 uppercase">Palettes</h3>}
      {plan && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="py-1 font-medium">Palette slot</th>
              <th className="py-1 font-medium">Device ID</th>
              <th className="py-1 font-medium">Palette</th>
              <th className="py-1 font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {plan.palettes.length === 0 && (
              <tr><td colSpan={4} className="py-2 text-neutral-500">No custom palettes in the library or on the controller.</td></tr>
            )}
            {plan.palettes.map((c) => {
              const p = palettes.find((x) => x.id === c.paletteId);
              return (
                <tr key={c.slot}>
                  <td className="py-1.5 font-mono text-xs text-neutral-400">{c.path}</td>
                  <td className="py-1.5 text-neutral-400">{c.deviceId}</td>
                  <td className="py-1.5">
                    {p ? (
                      <span className="flex items-center gap-2"><GradientSwatch stops={p.stops} className="h-3 w-12" />{p.name}</span>
                    ) : (
                      <span className="text-neutral-500">Not in library</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${actionStyle[c.action]}`}>{c.action}</span>
                    {c.replacesUnmanaged && <span className="ml-1.5 text-xs text-red-400">not from WLED Manager</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {plan && <PresetChanges plan={plan} />}
    </Card>
  );
}

function PresetChanges({ plan }: { plan: SyncPlan }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changed = plan.presets.filter((c) => c.action !== "unchanged" || c.warnings);
  const rows = showUnchanged ? plan.presets : changed;
  return (
    <>
      <div className="mt-4 mb-1 flex items-center justify-between">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">Presets</h3>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
          Show unchanged ({plan.presets.length - changed.length})
        </label>
      </div>
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-neutral-800">
          {rows.length === 0 && (
            <tr><td className="py-2 text-neutral-500">{plan.presets.length ? "No preset changes." : "No presets in the library or on the controller."}</td></tr>
          )}
          {rows.map((c) => (
            <tr key={c.slot}>
              <td className="w-12 py-1.5 text-neutral-400">{c.slot}</td>
              <td className="py-1.5">
                {c.name}
                {c.warnings?.map((w) => (
                  <div key={w} className="text-xs text-amber-400">{w}</div>
                ))}
              </td>
              <td className="py-1.5 text-right">
                {c.replacesUnmanaged && <span className="mr-1.5 text-xs text-red-400">not from WLED Manager</span>}
                <span className={`rounded px-1.5 py-0.5 text-xs ${actionStyle[c.action]}`}>{c.action}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.skippedPresets.length > 0 && (
        <details className="mt-2 text-xs text-neutral-500">
          <summary className="cursor-pointer">Not synced to this controller ({plan.skippedPresets.length})</summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {plan.skippedPresets.map((p) => (
              <li key={p.presetId}>
                {p.slot}. {p.name}: {p.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
