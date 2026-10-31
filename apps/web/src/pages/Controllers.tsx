import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Controller, ControllerExport, SyncPlan } from "@wled-manager/shared";
import { readControllerFile } from "../controllerFile";
import { useControllers, useSync, useSyncPlans } from "../queries";
import { AddControllerForm } from "../components/AddControllerForm";
import { planChanges, syncRisks } from "../components/SyncCard";
import { Button, ErrorText, FileButton, PageHeader, StatusDot, timeAgo } from "../components/ui";

export function Controllers() {
  const { data: controllers = [] } = useControllers();
  // false, or the form's contents: empty, or from an export file.
  const [adding, setAdding] = useState<false | { imported?: ControllerExport }>(false);
  const [fileError, setFileError] = useState<unknown>(null);

  const online = controllers.filter((c) => c.status === "online");
  const { results, check } = useSyncPlans(controllers.map((c) => c.id));
  const sync = useSync();
  const [busy, setBusy] = useState<null | "check" | "sync">(null);
  // How "Sync all" went for each controller it synced.
  const [synced, setSynced] = useState<Record<string, "syncing" | "done" | { error: unknown }>>({});
  const [note, setNote] = useState<string | null>(null);

  const checkAll = async () => {
    setBusy("check");
    setNote(null);
    await Promise.allSettled(online.map((c) => check(c.id)));
    setBusy(null);
  };
  const syncAll = async () => {
    setBusy("sync");
    setNote(null);
    setSynced({});
    try {
      // Fresh checks, so the confirmation lists what the syncs will really do.
      const checked = await Promise.allSettled(online.map((c) => check(c.id)));
      const pending = online.flatMap((c, i) => {
        const r = checked[i]!;
        return r.status === "fulfilled" && !r.value.inSync ? [{ c, plan: r.value }] : [];
      });
      const failed = checked.filter((r) => r.status === "rejected").length;
      if (!pending.length) {
        setNote(failed ? `Nothing to sync on the controllers that could be checked; ${failed} couldn't be.` : "Every online controller is already in sync.");
        return;
      }
      if (!confirm(syncAllMessage(pending, failed))) return;
      for (const { c } of pending) {
        setSynced((s) => ({ ...s, [c.id]: "syncing" }));
        try {
          await sync.mutateAsync(c.id);
          setSynced((s) => ({ ...s, [c.id]: "done" }));
        } catch (error) {
          setSynced((s) => ({ ...s, [c.id]: { error } }));
        }
      }
      await Promise.allSettled(pending.map(({ c }) => check(c.id)));
    } finally {
      setBusy(null);
    }
  };

  const importFile = (file: File) => {
    setFileError(null);
    readControllerFile(file).then((imported) => setAdding({ imported }), setFileError);
  };

  return (
    <div>
      <PageHeader
        title="Controllers"
        actions={
          !adding && (
            <>
              <Button onClick={checkAll} disabled={!!busy || !online.length} title="Compare every online controller with the library">
                {busy === "check" ? "Checking…" : "Check all"}
              </Button>
              <Button onClick={syncAll} disabled={!!busy || !online.length} title="Sync every online controller that has changes pending">
                {busy === "sync" ? "Syncing…" : "Sync all"}
              </Button>
              <FileButton accept=".json,application/json" onFile={importFile}>Import controller</FileButton>
              <Button variant="primary" onClick={() => setAdding({})}>Add controller</Button>
            </>
          )
        }
      />
      {!!fileError && <div className="mb-4"><ErrorText error={fileError} /></div>}
      {note && <p className="mb-4 text-sm text-neutral-400">{note}</p>}
      {adding && <AddControllerForm key={adding.imported?.exportedAt ?? "new"} imported={adding.imported} onDone={() => setAdding(false)} />}
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Address</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Firmware</th>
              <th className="px-4 py-2 font-medium">LEDs</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              <th className="px-4 py-2 font-medium">Last seen</th>
              <th className="px-4 py-2 font-medium">Sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {controllers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-neutral-500">
                  No controllers yet.
                </td>
              </tr>
            )}
            {controllers.map((c, i) => (
              <tr key={c.id} className="hover:bg-neutral-900/60">
                <td className="px-4 py-2">
                  <Link to="/controllers/$id" params={{ id: c.id }} className="font-medium text-sky-400 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-neutral-400">{c.host}{c.port !== 80 && `:${c.port}`}</td>
                <td className="px-4 py-2"><StatusDot status={c.status} /></td>
                <td className="px-4 py-2 text-neutral-400">{c.device?.version ?? "–"}</td>
                <td className="px-4 py-2 text-neutral-400">{c.device?.ledCount ?? "–"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-neutral-400">{timeAgo(c.lastSeen)}</td>
                <td className="px-4 py-2">
                  <SyncStatus controller={c} plan={results[i]} synced={synced[c.id]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The "Sync all" confirmation: what each controller gets, and what syncing would lose. */
function syncAllMessage(pending: { c: Controller; plan: SyncPlan }[], failed: number) {
  const lines = [`Sync ${pending.length} controller${pending.length === 1 ? "" : "s"}?`, ""];
  for (const { c, plan } of pending) {
    const { foreign, deletions } = syncRisks(plan);
    const n = planChanges(plan);
    lines.push(`${c.name}: ${n} change${n === 1 ? "" : "s"}${deletions ? `, removes ${deletions} item${deletions === 1 ? "" : "s"}` : ""}`);
    if (foreign.length) lines.push(`  Overwrites or removes items not written by WLED Manager: ${foreign.join(", ")}`);
  }
  if (pending.some(({ plan }) => syncRisks(plan).foreign.length)) lines.push("", "Import those items first if you want to keep them.");
  if (failed) lines.push("", `${failed} controller${failed === 1 ? "" : "s"} couldn't be checked and won't be synced.`);
  return lines.join("\n");
}

function SyncStatus({
  controller: c,
  plan,
  synced,
}: {
  controller: Controller;
  plan: ReturnType<typeof useSyncPlans>["results"][number] | undefined;
  synced: "syncing" | "done" | { error: unknown } | undefined;
}) {
  if (synced === "syncing") return <span className="text-xs text-sky-400">Syncing…</span>;
  if (synced && synced !== "done")
    return (
      <span className="text-xs text-red-400" title={synced.error instanceof Error ? synced.error.message : String(synced.error)}>
        Sync failed
      </span>
    );
  if (plan?.isFetching) return <span className="text-xs text-neutral-400">Checking…</span>;
  if (plan?.error)
    return (
      <span className="text-xs text-red-400" title={plan.error.message}>
        Check failed
      </span>
    );
  if (!plan?.data) return <span className="text-xs text-neutral-500">{c.status === "online" ? "Not checked" : "–"}</span>;
  if (plan.data.inSync) return <span className="text-xs text-emerald-400">{synced === "done" ? "Synced" : "In sync"}</span>;
  const n = planChanges(plan.data);
  return (
    <Link to="/controllers/$id" params={{ id: c.id }} className="text-xs text-amber-400 hover:underline">
      {n ? `${n} change${n === 1 ? "" : "s"} pending` : "Changes pending"}
    </Link>
  );
}
