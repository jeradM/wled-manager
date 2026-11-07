import { describe, expect, it } from "vitest";
import { patternProblem, patternSegments, type PatternRun } from "./pattern.js";
import { Simulator } from "./sim/index.js";
import type { WledColor } from "./schemas.js";

const red: WledColor = [255, 0, 0];
const blue: WledColor = [0, 0, 255];

/** The strip as letters: R, G, B, or . for dark. */
function render(segs: ReturnType<typeof patternSegments>, count: number) {
  const sim = new Simulator(count);
  sim.apply({ on: true, bri: 255, seg: segs.map((s, id) => ({ ...s, id })) }, () => null);
  return [...sim.frame(0)].map((c) => (c === 0 ? "." : c & 0xff0000 ? "R" : c & 0xff ? "B" : "G")).join("");
}

describe("patternSegments", () => {
  it("gives each colored run a segment grouped by its length and spaced by the rest", () => {
    const runs: PatternRun[] = [
      { count: 2, color: red },
      { count: 1, color: null },
      { count: 3, color: blue },
    ];
    const segs = patternSegments(runs, 10, 40, "Candy");
    expect(segs).toEqual([
      expect.objectContaining({ n: "Candy 1", start: 10, stop: 40, grp: 2, spc: 4, bm: 0, col: [red] }),
      expect.objectContaining({ n: "Candy 2", start: 13, stop: 40, grp: 3, spc: 3, col: [blue] }),
    ]);
  });

  it("lights the right LEDs in the simulator", () => {
    const runs: PatternRun[] = [
      { count: 2, color: red },
      { count: 1, color: null },
      { count: 3, color: blue },
    ];
    const sim = new Simulator(18);
    sim.apply({ on: true, bri: 255, seg: patternSegments(runs, 0, 18).map((s, id) => ({ ...s, id })) }, () => null);
    const px = sim.frame(0);
    const kind = [...px].map((c) => (c === 0 ? "." : (c & 0xff0000) ? "R" : "B")).join("");
    expect(kind).toBe("RR.BBB".repeat(3));
  });

  it("overlaps segments to use fewer: C1 C2 C3 C2 C1 from three", () => {
    const green: WledColor = [0, 255, 0];
    const runs: PatternRun[] = [
      { count: 1, color: null },
      { count: 1, color: red },
      { count: 1, color: green },
      { count: 1, color: blue },
      { count: 1, color: green },
      { count: 1, color: red },
      { count: 1, color: null },
    ];
    const segs = patternSegments(runs, 0, 21);
    expect(segs.map((s) => [s.start, s.grp, s.spc, s.col])).toEqual([
      [1, 5, 2, [red]],
      [2, 3, 4, [green]],
      [3, 1, 6, [blue]],
    ]);
    expect(render(segs, 21)).toBe(".RGBGR.".repeat(3));
  });

  it("lights the same LEDs as one segment per run, for any pattern", () => {
    const palette: (WledColor | null)[] = [null, red, blue, [0, 255, 0]];
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let t = 0; t < 300; t++) {
      const runs: PatternRun[] = Array.from({ length: 1 + rand(9) }, () => ({ count: 1 + rand(3), color: palette[rand(4)]! }));
      if (!runs.some((r) => r.color)) continue;
      const length = runs.reduce((n, r) => n + r.count, 0);
      const stop = length * 2 + rand(length);
      const segs = patternSegments(runs, 0, stop);
      const expected = runs.flatMap((r) => Array.from({ length: r.count }, () => (r.color === red ? "R" : r.color === blue ? "B" : r.color ? "G" : "."))).join("");
      expect(render(segs, stop)).toBe(expected.repeat(3).slice(0, stop));
      expect(segs.length).toBeLessThanOrEqual(runs.filter((r) => r.color).length);
    }
  });

  it("skips runs that start past the end and names a single segment plainly", () => {
    const segs = patternSegments([{ count: 5, color: red }, { count: 5, color: blue }], 0, 4);
    expect(segs).toEqual([expect.objectContaining({ n: "Pattern", grp: 5, spc: 5 })]);
  });

  it("reports patterns WLED can't make", () => {
    expect(patternProblem([{ count: 3, color: null }], 0, 10)).toMatch(/colored run/);
    expect(patternProblem([{ count: 3, color: red }], 5, 5)).toMatch(/Stop LED/);
    expect(patternProblem([{ count: 300, color: red }], 0, 1000)).toMatch(/at most 255/);
    expect(patternProblem([{ count: 1, color: red }, { count: 300, color: null }], 0, 1000)).toMatch(/repeat within 255/);
    expect(patternProblem([{ count: 2, color: red }], 0, 10)).toBeNull();
    expect(patternSegments([{ count: 3, color: null }], 0, 10)).toEqual([]);
  });
});
