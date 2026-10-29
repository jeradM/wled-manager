import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { layoutStrips, type Controller, type Layout } from "@wled-manager/shared";
import { useLayouts } from "../../queries";

/**
 * Where simulated lights are shown: as a strip, or on one of the layouts. The choice is remembered under
 * `storageKey`. Returns the chosen layout (undefined for the strip) and the picker.
 */
export function useLayoutView(storageKey: string): [Layout | undefined, React.ReactNode] {
  const { data: layouts = [] } = useLayouts();
  const [chosen, setChosen] = useState(() => localStorage.getItem(storageKey) ?? "");
  const layout = layouts.find((l) => l.id === chosen);
  const picker = (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-xs text-neutral-400">
        View
        <Link to="/layouts" className="text-sky-400 hover:text-sky-300">
          Layouts
        </Link>
      </span>
      <select
        value={layout?.id ?? ""}
        onChange={(e) => {
          setChosen(e.target.value);
          localStorage.setItem(storageKey, e.target.value);
        }}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
        aria-label="View"
      >
        <option value="">Strip</option>
        {layouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
  return [layout, picker];
}

/** "Garage 421 LEDs · Porch 120 LEDs": what each controller on a layout runs. */
export function layoutSummary(layout: Layout, controllers: Controller[]) {
  return layoutStrips(layout)
    .map((s) => `${s.controllerId === null ? "Unassigned" : (controllers.find((c) => c.id === s.controllerId)?.name ?? "Removed controller")} ${s.ledCount} LEDs`)
    .join(" · ");
}
