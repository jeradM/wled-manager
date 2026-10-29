import { describe, expect, it } from "vitest";
import { layoutStrips, lineFirstLeds, stateForController } from "./layout.js";
import type { LayoutLine } from "./schemas.js";
import type { SegmentSource } from "./segments.js";

const line = (id: string, controllerId: string | null, count: number, extra: Partial<LayoutLine> = {}): LayoutLine => ({
  id,
  controllerId,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  count,
  ...extra,
});

describe("layoutStrips", () => {
  it("spaces lights evenly from the first to the last, both ends included", () => {
    const [strip] = layoutStrips({ lines: [line("a", "c1", 5)] });
    expect(strip!.lights.map((l) => l.x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(strip!.lights.map((l) => l.led)).toEqual([0, 1, 2, 3, 4]);
    expect(layoutStrips({ lines: [line("a", "c1", 1)] })[0]!.lights).toEqual([{ line: 0, index: 0, led: 0, x: 0, y: 0 }]);
  });

  it("numbers a flipped line from its other end", () => {
    const [strip] = layoutStrips({ lines: [line("a", "c1", 3, { from: { x: 1, y: 0 }, to: { x: 0, y: 0 } })] });
    expect(strip!.lights.map((l) => [l.led, l.x])).toEqual([[0, 1], [1, 0.5], [2, 0]]);
  });

  it("continues each controller's numbering, skips gaps, and honours explicit first LEDs", () => {
    const lines = [
      line("a", "c1", 3),
      line("b", "c2", 2),
      line("gap", "c1", 0),
      line("c", "c1", 2),
      line("d", "c1", 2, { firstLed: 10 }),
      line("e", null, 1),
    ];
    expect(lineFirstLeds(lines)).toEqual([0, 0, 3, 3, 10, 0]);
    const strips = layoutStrips({ lines });
    expect(strips.map((s) => [s.controllerId, s.ledCount, s.lights.length])).toEqual([
      ["c1", 12, 7],
      ["c2", 2, 2],
      [null, 1, 1],
    ]);
    expect(strips[0]!.lights.filter((l) => l.line === 2)).toEqual([]);
  });
});

describe("stateForController", () => {
  const garage: SegmentSource = {
    id: "garage",
    segments: [{ id: "g-roof", name: "Roof", start: 10, end: { type: "length", count: 10 } }],
    markers: [],
    ranges: [],
    device: { ledCount: 100 },
  };
  const porch: SegmentSource = { id: "porch", segments: [], markers: [], ranges: [], device: { ledCount: 50 } };

  it("gives defined segments the controller's LEDs and leaves out ones it doesn't have", () => {
    const state = { seg: [{ id: 0, sid: "g-roof", start: 0, stop: 5, fx: 2, layers: [{ fx: 1 }] }, { id: 1, start: 0, stop: 5, fx: 0 }] };
    expect(stateForController(state, garage, [garage, porch]).seg[0]).toMatchObject({ start: 10, stop: 20, fx: 2, layers: [{ fx: 1 }] });
    expect(stateForController(state, porch, [garage, porch]).seg).toEqual([{ id: 0, stop: 0 }, state.seg[1]]);
  });
});
