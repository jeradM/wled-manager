import { useEffect, useState } from "react";
import { stopsToCss, type ImportPalette, type ImportPreset } from "@wled-manager/shared";
import { useImport, useImportPreview } from "../queries";
import { Button, Card, ErrorText } from "./ui";

/** What pulling a preset does, and its color. */
function presetStatus(p: ImportPreset): [string, string] {
  switch (p.status) {
    case "new":
      return ["New: adds it to the library", "text-emerald-400"];
    case "identical":
      return ["In sync", "text-neutral-500"];
    case "changed":
      return p.edited
        ? [`Edited on controller: updates "${p.libraryName}"`, "text-sky-400"]
        : [`Library is newer: pulling undoes changes to "${p.libraryName}"`, "text-neutral-400"];
    case "conflict":
      return p.edited
        ? [`Edited on controller: replaces "${p.libraryName}"`, "text-amber-400"]
        : [`Library is newer: pulling replaces "${p.libraryName}"`, "text-neutral-400"];
  }
}

function paletteStatus(p: ImportPalette): [string, string] {
  if (p.status === "new") return ["new", "text-emerald-400"];
  if (p.status === "in-library") return [`same as "${p.libraryName}"`, "text-neutral-500"];
  return p.edited ? [`edited: updates "${p.libraryName}"`, "text-sky-400"] : [`library "${p.libraryName}" is newer`, "text-neutral-400"];
}

/** Whether pulling an item is picked to begin with: new ones, and ones edited on the controller that merge cleanly. */
const pickedAtFirst = (p: ImportPalette | ImportPreset) => p.status === "new" || (p.status === "changed" && !!p.edited);

/**
 * Pulls a controller's palettes and presets into the library: new ones are added, and changes made on the
 * controller (e.g. in the WLED UI) are brought into the library's versions. Only reads from the controller.
 */
export function ImportPanel({ controllerId, onClose }: { controllerId: string; onClose: () => void }) {
  const { data: preview, error, isFetching } = useImportPreview(controllerId, true);
  const run = useImport(controllerId);
  const [palettes, setPalettes] = useState<Set<number>>(new Set());
  const [presets, setPresets] = useState<Set<number>>(new Set());
  const [showInSync, setShowInSync] = useState(false);

  useEffect(() => {
    if (!preview) return;
    setPalettes(new Set(preview.palettes.filter(pickedAtFirst).map((p) => p.slot)));
    setPresets(new Set(preview.presets.filter(pickedAtFirst).map((p) => p.slot)));
  }, [preview]);

  const toggle = (set: Set<number>, update: (s: Set<number>) => void, slot: number, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(slot);
    else next.delete(slot);
    update(next);
  };

  // Pulling a preset brings along the new custom palettes it uses.
  const togglePreset = (p: ImportPreset, on: boolean) => {
    toggle(presets, setPresets, p.slot, on);
    if (on && p.paletteSlots.length) {
      const next = new Set(palettes);
      p.paletteSlots.forEach((s) => preview?.palettes.find((x) => x.slot === s)?.status === "new" && next.add(s));
      setPalettes(next);
    }
  };

  const replacing = preview?.presets.filter((p) => p.status === "conflict" && presets.has(p.slot)) ?? [];
  const undoing = [...(preview?.presets ?? []), ...(preview?.palettes ?? [])].filter(
    (p) => p.status !== "new" && p.status !== "identical" && !p.edited && (("kind" in p ? presets : palettes).has(p.slot)),
  );
  const submit = () => {
    const warnings = [
      replacing.length && `${replacing.length} library preset(s) will be replaced with the controller's version, losing anything the controller can't hold (segment definitions, layered effect links, groups).`,
      undoing.length && `${undoing.length} item(s) were changed in the library since the last sync; pulling undoes those changes.`,
    ].filter(Boolean);
    if (warnings.length && !confirm(`${warnings.join("\n\n")}\n\nContinue?`)) return;
    run.mutate({ palettes: [...palettes], presets: [...presets] });
  };

  const inSync = preview?.presets.filter((p) => p.status === "identical").length ?? 0;
  const listed = preview?.presets.filter((p) => showInSync || p.status !== "identical") ?? [];
  const count = palettes.size + presets.size;

  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Pull from controller</h2>
          <p className="text-xs text-neutral-500">
            Brings palettes and presets into your library, including changes made on the controller (for example in the WLED
            UI). Edited presets only take the settings that changed. Nothing on the controller changes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={submit} disabled={!preview || run.isPending || !count}>
            {run.isPending ? "Pulling…" : `Pull ${count} item${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
      <ErrorText error={error ?? run.error} />
      {run.isSuccess && (
        <p className="mb-3 rounded bg-emerald-950/50 px-2 py-1 text-xs text-emerald-300">
          Pulled {run.data.presetsImported} preset(s); {run.data.palettesCreated} new and {run.data.palettesUpdated} updated palette(s)
          {run.data.palettesLinked ? `; linked ${run.data.palettesLinked} palette(s) already in your library` : ""}.
        </p>
      )}
      {isFetching && !preview && <p className="text-sm text-neutral-400">Reading controller…</p>}
      {preview && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_2fr]">
          <div>
            <h3 className="mb-2 text-sm text-neutral-400">Custom palettes ({preview.palettes.length})</h3>
            {preview.palettes.length === 0 && <p className="text-xs text-neutral-500">None.</p>}
            <div className="flex flex-col gap-1.5">
              {preview.palettes.map((p) => {
                const [label, color] = paletteStatus(p);
                return (
                  <label key={p.slot} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={p.status === "in-library"}
                      checked={p.status === "in-library" || palettes.has(p.slot)}
                      onChange={(e) => toggle(palettes, setPalettes, p.slot, e.target.checked)}
                    />
                    <span className="h-4 w-16 shrink-0 rounded" style={{ background: stopsToCss(p.stops) }} />
                    <span className="text-neutral-400">#{p.slot}</span>
                    <span className={`text-xs ${color}`}>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm text-neutral-400">Presets ({preview.presets.length})</h3>
              <div className="flex items-center gap-3 text-xs">
                {inSync > 0 && (
                  <label className="flex items-center gap-1.5 text-neutral-400">
                    <input type="checkbox" checked={showInSync} onChange={(e) => setShowInSync(e.target.checked)} />
                    Show {inSync} in sync
                  </label>
                )}
                <button
                  type="button"
                  className="text-sky-400 hover:underline"
                  onClick={() => preview.presets.forEach((p) => p.status !== "identical" && togglePreset(p, true))}
                >
                  Select all
                </button>
                <button type="button" className="text-sky-400 hover:underline" onClick={() => setPresets(new Set())}>
                  None
                </button>
              </div>
            </div>
            {listed.length === 0 && <p className="text-xs text-neutral-500">Every preset on the controller is in sync with the library.</p>}
            <div className="max-h-96 overflow-y-auto pr-1">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-neutral-800">
                  {listed.map((p) => {
                    const [label, color] = presetStatus(p);
                    return (
                      <tr key={p.slot} className="align-top">
                        <td className="w-6 py-1.5">
                          <input
                            type="checkbox"
                            disabled={p.status === "identical"}
                            checked={presets.has(p.slot)}
                            onChange={(e) => togglePreset(p, e.target.checked)}
                            aria-label={`Pull ${p.name}`}
                          />
                        </td>
                        <td className="w-10 py-1.5 text-neutral-500">{p.slot}</td>
                        <td className="py-1.5">
                          {p.name}
                          {p.kind === "raw" && <span className="ml-2 text-xs text-neutral-500">raw</span>}
                          {p.changes?.map((c) => (
                            <div key={c} className="text-xs text-neutral-400">{c}</div>
                          ))}
                          {p.notes?.map((n) => (
                            <div key={n} className="text-xs text-amber-400/80">{n}</div>
                          ))}
                        </td>
                        <td className={`py-1.5 text-right text-xs ${color}`}>{label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
