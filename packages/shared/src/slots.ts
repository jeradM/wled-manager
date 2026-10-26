/**
 * Assigns library palettes to /paletteN.json slots on one controller.
 *
 * WLED loads custom palettes from palette0.json upward and stops at the first missing file, so slots
 * must stay contiguous from 0. Within that constraint assignments are kept stable: a palette keeps its
 * slot across syncs, and when one is removed the highest-slot palette moves into the hole, so only one
 * device palette ID changes.
 *
 * @param existing current paletteId -> slot assignments for this controller
 * @param desired palette IDs that should be on the controller, in priority order
 * @param max the controller's custom palette capacity
 */
export function assignPaletteSlots(
  existing: Record<string, number>,
  desired: string[],
  max: number,
): { slots: Record<string, number>; overflow: string[] } {
  const size = Math.min(desired.length, max);
  const slots: Record<string, number> = {};
  const used = new Set<number>();

  // Previously assigned palettes come first so new ones are the ones that overflow.
  const previous = desired.filter((id) => existing[id] !== undefined);
  const fresh = desired.filter((id) => existing[id] === undefined);

  const displaced: string[] = [];
  for (const id of previous) {
    const slot = existing[id]!;
    if (slot < size && !used.has(slot)) {
      slots[id] = slot;
      used.add(slot);
    } else {
      displaced.push(id);
    }
  }
  displaced.sort((a, b) => existing[b]! - existing[a]!);

  const candidates = [...displaced, ...fresh];
  const overflow: string[] = [];
  let next = 0;
  for (const id of candidates) {
    while (used.has(next)) next++;
    if (next >= size) {
      overflow.push(id);
      continue;
    }
    slots[id] = next;
    used.add(next);
  }
  return { slots, overflow };
}
