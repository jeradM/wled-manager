import type { Layout, LayoutLine, PresetState } from "./schemas.js";
import { isClearMarker, linkSegment, resolveSegmentRef, type SegmentSource } from "./segments.js";

/** One light on a layout: where it is (fractions of the image) and which LED it is on its controller. */
export interface LayoutLight {
  /** Position of its line in the layout. */
  line: number;
  /** Position along its line, from its first light. */
  index: number;
  led: number;
  x: number;
  y: number;
}

/** The lights of one controller on a layout (or of lines assigned to none: controllerId null). */
export interface LayoutStrip {
  controllerId: string | null;
  /** LEDs the strip needs: one past its highest LED number. */
  ledCount: number;
  lights: LayoutLight[];
}

/** The LED number of each line's first light, in layout order (lines without one continue their controller's numbering). */
export function lineFirstLeds(lines: LayoutLine[]): number[] {
  const next = new Map<string | null, number>();
  return lines.map((l) => {
    const first = l.firstLed ?? next.get(l.controllerId) ?? 0;
    next.set(l.controllerId, first + l.count);
    return first;
  });
}

/** Where a line's lights are: evenly spaced from its first light to its last, both ends included. */
export function linePoints(l: LayoutLine): { x: number; y: number }[] {
  return Array.from({ length: l.count }, (_, i) => {
    const t = l.count === 1 ? 0 : i / (l.count - 1);
    return { x: l.from.x + (l.to.x - l.from.x) * t, y: l.from.y + (l.to.y - l.from.y) * t };
  });
}

/** A layout's lights grouped by controller, controllers in the order their first line appears; unassigned lines last. */
export function layoutStrips(layout: Pick<Layout, "lines">): LayoutStrip[] {
  const firsts = lineFirstLeds(layout.lines);
  const strips = new Map<string | null, LayoutStrip>();
  layout.lines.forEach((l, line) => {
    if (!strips.has(l.controllerId)) strips.set(l.controllerId, { controllerId: l.controllerId, ledCount: 0, lights: [] });
    const strip = strips.get(l.controllerId)!;
    linePoints(l).forEach((p, index) => {
      const led = firsts[line]! + index;
      strip.lights.push({ line, index, led, ...p });
      strip.ledCount = Math.max(strip.ledCount, led + 1);
    });
  });
  return [...strips.values()]
    .filter((s) => s.lights.length > 0)
    .sort((a, b) => (a.controllerId === null ? 1 : 0) - (b.controllerId === null ? 1 : 0));
}

/**
 * A preset's light state as a controller runs it: segments using a defined segment take that controller's
 * LEDs, and ones it doesn't have are left out (turned into clear markers, keeping every segment's position).
 */
export function stateForController(state: PresetState, controller: SegmentSource, all: SegmentSource[]): PresetState {
  if (!state.seg.some((s) => s.sid !== undefined && !isClearMarker(s))) return state;
  return {
    ...state,
    seg: state.seg.map((s, p) => {
      if (s.sid === undefined || isClearMarker(s)) return s;
      const r = resolveSegmentRef(s.sid, controller, all);
      return r.ok ? linkSegment(s, s.sid, r.segment) : { id: s.id ?? p, stop: 0 };
    }),
  };
}
