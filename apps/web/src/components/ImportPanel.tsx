import { useEffect, useState } from "react";
import { stopsToCss, type ImportPreset } from "@wled-manager/shared";
import { useImport, useImportPreview } from "../queries";
import { Button, Card, ErrorText } from "./ui";

const statusText: Record<ImportPreset["status"], [string, string]> = {
  new: ["New", "text-emerald-400"],
  identical: ["Already in library", "text-neutral-500"],
  conflict: ["Replaces library preset", "text-amber-400"],
};

/** Pulls a controller's palettes and presets into the library. Only reads from the controller. */
export function ImportPanel({ controllerId, onClose }: { controllerId: string; onClose: () => void }) {
  const { data: preview, error, isFetching } = useImportPreview(controllerId, true);
  const run = useImport(controllerId);
  const [palettes, setPalettes] = useState<Set<number>>(new Set());
  const [presets, setPresets] = useState<Set<number>>(new Set());

  // Default: everything new, nothing that would replace a library preset.
  useEffect(() => {
    if (!preview) return;
    setPalettes(new Set(preview.palettes.filter((p) => p.status === "new").map((p) => p.slot)));
    setPresets(new Set(preview.presets.filter((p) => p.status === "new").map((p) => p.slot)));
  }, [preview]);

  const toggle = (set: Set<number>, update: (s: Set<number>) => void, slot: number, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(slot);
    else next.delete(slot);
    update(next);
  };

  // Importing a preset brings along the custom palettes it uses.
  const togglePreset = (p: ImportPreset, on: boolean) => {
    toggle(presets, setPresets, p.slot, on);
    if (on && p.paletteSlots.length) {
      const next = new Set(palettes);
      p.paletteSlots.forEach((s) => preview?.palettes.find((x) => x.slot === s)?.status === "new" && next.add(s));
      setPalettes(next);
    }
  };

  const conflicts = preview?.presets.filter((p) => p.status === "conflict" && presets.has(p.slot)) ?? [];
  const submit = () => {
    if (conflicts.length && !confirm(`Replace ${conflicts.length} preset(s) in your library with the controller's version?`)) return;
    run.mutate({ palettes: [...palettes], presets: [...presets] });
  };

  return (
    <Card className="lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Import from controller</h2>
          <p className="text-xs text-neutral-500">Copies palettes and presets into your library. Nothing on the controller changes.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={submit} disabled={!preview || run.isPending || (!palettes.size && !presets.size)}>
            {run.isPending ? "Importing…" : `Import ${palettes.size + presets.size} item(s)`}
          </Button>
        </div>
      </div>
      <ErrorText error={error ?? run.error} />
      {run.isSuccess && (
        <p className="mb-3 rounded bg-emerald-950/50 px-2 py-1 text-xs text-emerald-300">
          Imported {run.data.presetsImported} preset(s) and {run.data.palettesCreated} new palette(s)
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
              {preview.palettes.map((p) => (
                <label key={p.slot} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={p.status === "in-library"}
                    checked={p.status === "in-library" || palettes.has(p.slot)}
                    onChange={(e) => toggle(palettes, setPalettes, p.slot, e.target.checked)}
                  />
                  <span className="h-4 w-16 shrink-0 rounded" style={{ background: stopsToCss(p.stops) }} />
                  <span className="text-neutral-400">#{p.slot}</span>
                  {p.status === "in-library" && <span className="text-xs text-neutral-500">same as "{p.libraryName}"</span>}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm text-neutral-400">Presets ({preview.presets.length})</h3>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-sky-400 hover:underline" onClick={() => preview.presets.forEach((p) => p.status !== "identical" && togglePreset(p, true))}>
                  Select all
                </button>
                <button type="button" className="text-sky-400 hover:underline" onClick={() => setPresets(new Set())}>
                  None
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-neutral-800">
                  {preview.presets.map((p) => {
                    const [label, color] = statusText[p.status];
                    return (
                      <tr key={p.slot}>
                        <td className="w-6 py-1">
                          <input
                            type="checkbox"
                            disabled={p.status === "identical"}
                            checked={presets.has(p.slot)}
                            onChange={(e) => togglePreset(p, e.target.checked)}
                          />
                        </td>
                        <td className="w-10 py-1 text-neutral-500">{p.slot}</td>
                        <td className="py-1">
                          {p.name}
                          {p.kind === "raw" && <span className="ml-2 text-xs text-neutral-500">raw</span>}
                        </td>
                        <td className={`py-1 text-right text-xs ${color}`}>
                          {label}
                          {p.status === "conflict" && ` "${p.libraryName}"`}
                        </td>
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
