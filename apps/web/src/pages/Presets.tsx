import { Link } from "@tanstack/react-router";
import { stopsToCss } from "@wled-manager/shared";
import { useCatalog, useControllers, usePalettes, usePresets } from "../queries";
import { effectNames, rawKind, realSegments } from "../components/preset/describe";
import { Button, Card, PageHeader } from "../components/ui";

export function Presets() {
  const { data: presets = [], isLoading } = usePresets();
  const { data: palettes = [] } = usePalettes();
  const { data: controllers = [] } = useControllers();
  const { data: catalog } = useCatalog(controllers[0]?.id);

  return (
    <div>
      <PageHeader
        title="Presets"
        actions={
          <Link to="/presets/new">
            <Button variant="primary">New preset</Button>
          </Link>
        }
      />
      {!isLoading && presets.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">
            No presets yet. Create one, or import a controller's presets from its page under Controllers.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-xs text-neutral-400">
              <tr>
                <th className="w-14 px-4 py-2 font-medium">Slot</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Contents</th>
                <th className="px-4 py-2 font-medium">Palettes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {presets.map((p) => {
                const used = p.kind === "state" ? p.state!.seg.flatMap((s) => (typeof s.pal === "object" ? [s.pal.paletteId] : [])) : [];
                const usedPalettes = palettes.filter((x) => used.includes(x.id));
                return (
                  <tr key={p.id} className="hover:bg-neutral-900/60">
                    <td className="px-4 py-2 text-neutral-400">{p.slot}</td>
                    <td className="px-4 py-2">
                      <Link to="/presets/$id" params={{ id: p.id }} className="font-medium text-sky-400 hover:underline">
                        {p.name}
                      </Link>
                      {p.ql && <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs">{p.ql}</span>}
                    </td>
                    <td className="px-4 py-2 text-neutral-400">
                      {p.kind === "state"
                        ? `${realSegments(p).length} segment${realSegments(p).length === 1 ? "" : "s"}: ${effectNames(p, catalog?.effects ?? []).join(", ") || "no effect set"}`
                        : rawKind(p.raw)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {usedPalettes.map((x) => (
                          <span key={x.id} title={x.name} className="h-3 w-10 rounded" style={{ background: stopsToCss(x.stops) }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
