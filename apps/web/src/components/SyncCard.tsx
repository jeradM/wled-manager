import type { ChangeAction } from "@wled-manager/shared";
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

  const foreign = plan?.palettes.filter((c) => c.replacesUnmanaged) ?? [];
  const deletions = plan?.palettes.filter((c) => c.action === "delete").length ?? 0;
  const apply = () => {
    const message = foreign.length
      ? `${foreign.length} palette(s) on this controller weren't created by WLED Manager and will be overwritten or removed:\n` +
        foreign.map((c) => `  ${c.path} (palette ${c.deviceId})`).join("\n") +
        "\n\nContinue?"
      : deletions
        ? `This removes ${deletions} palette file(s) from the controller. Continue?`
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
          {foreign.length} palette(s) on this controller weren't created by WLED Manager. Syncing replaces them.
        </p>
      )}
      {plan?.warnings.map((w) => (
        <p key={w} className="mb-2 rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-300">{w}</p>
      ))}
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
    </Card>
  );
}
