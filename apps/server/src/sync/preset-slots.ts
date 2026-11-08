import { orderedPresetSlots, presetSkipReason, type Preset, type Settings } from "@wled-manager/shared";
import type { ControllerService } from "../services/controllers.js";

/**
 * Library presets that go to a controller, those that don't (and why), and the device slot each goes in:
 * its own slot, or with ordered slots its place among this controller's presets by group and name.
 */
export function controllerPresets(all: Preset[], controllerId: string, controllers: ControllerService, mode: Settings["presetSlots"]) {
  const sources = controllers.list();
  const target = sources.find((c) => c.id === controllerId)!;
  const skipped: { presetId: string; slot: number; name: string; reason: string }[] = [];
  const going = all.filter((p) => {
    const reason = presetSkipReason(p, target, sources);
    if (reason) skipped.push({ presetId: p.id, slot: p.slot, name: p.name, reason });
    return !reason;
  });
  const ordered = mode === "ordered" ? orderedPresetSlots(going) : null;
  const slotOf = (p: { id: string; slot: number }) => ordered?.get(p.id) ?? p.slot;
  return { going, skipped, slotOf, ordered: !!ordered };
}
