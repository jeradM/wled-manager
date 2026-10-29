import type { ReactNode } from "react";
import { segmentLayers, withLayers, type LedMarker, type Palette, type Segment } from "@wled-manager/shared";
import type { Catalog } from "../../queries";
import { LayerStack } from "./LayerStack";

/** Placement fields the editor doesn't edit, kept as they are (set from the definition on defined segments). */
const OTHER_PLACEMENT = ["rev", "n"];

interface Props {
  index: number;
  segment: Segment;
  catalog: Catalog | undefined;
  library: Palette[];
  rgbw: boolean;
  /** Labelled LED positions on the source controller, suggested for start/stop. */
  markers: LedMarker[];
  onChange: (s: Segment) => void;
  onRemove?: () => void;
  /** Adds a copy of this segment right below it. */
  onCopy?: () => void;
  /** Heading; defaults to "Segment <id>". */
  title?: ReactNode;
  /** Shown before the heading, e.g. a drag handle. */
  leading?: ReactNode;
  /** Shown in the header next to the controls, e.g. a group picker. */
  headerExtra?: ReactNode;
  /** Where the segment's LEDs come from, shown above the settings. */
  source?: ReactNode;
  /** Hide start/stop: when editing several segments at once, or when a defined segment sets them. */
  hideGeometry?: boolean;
  /** Left border color, e.g. the segment's group. */
  accent?: string;
  /** How many more layers fit (each layer is a WLED segment). Defaults to no limit. */
  layerRoom?: number;
  /** Shown in each layer's header; given the layer's index (0 = bottom). */
  layerExtra?: (k: number) => ReactNode;
  /** Called when layers move or go, with each old layer index's new one (undefined when removed). */
  onLayerRemap?: (map: (k: number) => number | undefined) => void;
}

const numberOrUndefined = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.round(Number(v)) || 0));

/** A preset segment: which LEDs (start and stop, or a defined segment), and the stack of layers drawn on them. */
export function SegmentEditor({
  index,
  segment: s,
  catalog,
  library,
  rgbw,
  markers,
  onChange,
  onRemove,
  onCopy,
  title,
  leading,
  headerExtra,
  source,
  hideGeometry,
  accent,
  layerRoom,
  layerExtra,
  onLayerRemap,
}: Props) {
  const markerList = `segment-markers-${index}`;
  const set = (patch: Partial<Segment>) => onChange({ ...s, ...patch });
  const kept = s.sid ? [] : OTHER_PLACEMENT.filter((k) => k in s);

  return (
    <div
      className={`rounded-lg border border-neutral-800 p-3 ${accent ? "border-l-4" : ""}`}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {leading}
          {title ?? `Segment ${s.id ?? index}`}
        </span>
        <div className="flex items-center gap-3 text-xs">
          {headerExtra}
          {onCopy && (
            <button type="button" onClick={onCopy} className="text-sky-400 hover:text-sky-300" title="Add a copy of this segment right below it">
              Copy
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">Remove</button>
          )}
        </div>
      </div>

      {source && <div className="mb-3 text-sm">{source}</div>}

      {!hideGeometry && (
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Start LED</span>
            <input
              value={s.start ?? ""}
              onChange={(e) => set({ start: numberOrUndefined(e.target.value) })}
              list={markerList}
              placeholder="keep"
              inputMode="numeric"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Stop LED</span>
            <input
              value={s.stop ?? ""}
              onChange={(e) => set({ stop: numberOrUndefined(e.target.value) })}
              list={markerList}
              placeholder="keep"
              inputMode="numeric"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          {kept.length > 0 && <p className="col-span-2 self-end pb-1.5 text-xs text-neutral-500 sm:col-span-3">Also kept as-is: {kept.join(", ")}</p>}
          <datalist id={markerList}>
            {markers.map((m) => (
              <option key={m.index} value={m.index}>{m.label}</option>
            ))}
          </datalist>
        </div>
      )}

      <LayerStack
        layers={segmentLayers(s)}
        onChange={(layers) => onChange(withLayers(s, layers))}
        room={layerRoom}
        catalog={catalog}
        library={library}
        rgbw={rgbw}
        layerExtra={layerExtra}
        onRemap={onLayerRemap}
      />
    </div>
  );
}
