import type { Palette, PaletteRef } from "@wled-manager/shared";
import { stopsToCss } from "@wled-manager/shared";

/** Select for a segment palette: library palettes (synced per controller) or WLED built-ins. */
export function PalettePicker({
  value,
  builtins,
  library,
  onChange,
}: {
  value: PaletteRef | undefined;
  builtins: string[];
  library: Palette[];
  onChange: (ref: PaletteRef) => void;
}) {
  const selected =
    value === undefined ? "" : typeof value === "number" ? `b:${value}` : `l:${value.paletteId}`;
  const libraryPalette = typeof value === "object" ? library.find((p) => p.id === value.paletteId) : undefined;
  // A numeric ID past the built-ins is a device custom palette the library doesn't know.
  const unknownDevicePalette = typeof value === "number" && value >= builtins.length;

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => {
          const [kind, id] = [e.target.value.slice(0, 1), e.target.value.slice(2)];
          onChange(kind === "l" ? { paletteId: id } : Number(id));
        }}
        className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        {value === undefined && <option value="">(unchanged)</option>}
        {typeof value === "object" && !libraryPalette && <option value={selected}>Deleted palette</option>}
        {library.length > 0 && (
          <optgroup label="Your palettes">
            {library.map((p) => (
              <option key={p.id} value={`l:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="WLED built-in">
          {builtins.map((name, id) => (
            <option key={id} value={`b:${id}`}>{name}</option>
          ))}
          {unknownDevicePalette && <option value={selected}>Device palette {value}</option>}
        </optgroup>
      </select>
      {libraryPalette && <span className="h-4 w-12 shrink-0 rounded" style={{ background: stopsToCss(libraryPalette.stops) }} />}
    </div>
  );
}
