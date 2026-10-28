import { describe, expect, it } from "vitest";
import type { PresetState } from "../schemas.js";
import { ColorFromPalette, LINEARBLEND, gradientPalette } from "./color.js";
import { FX_METADATA } from "./fxdata.js";
import { GRADIENT_PALETTES } from "./palettes.js";
import { SIM_EFFECTS, Simulator, effectDefaults, simCatalog, stopsToPalette16, wledColorToInt } from "./index.js";
import { cubicwave8, scale8, sin16_t, sin8_t, triwave8 } from "./math.js";

const noPalettes = () => null;
const run = (sim: Simulator, frames: number, from = 0) => {
  for (let f = 0; f < frames; f++) sim.frame(from + f * 23);
  return sim.strip.pixels;
};

describe("integer math", () => {
  it("matches FastLED's wave tables", () => {
    expect(sin8_t(0)).toBe(128);
    expect(sin8_t(64)).toBe(255);
    expect(sin8_t(192)).toBe(0); // WLED derives sin8_t from sin16_t
    expect(sin16_t(0)).toBe(0);
    expect(sin16_t(16384)).toBe(32766); // WLED's rational approximation peaks just short of 32767
    expect(sin16_t(49152)).toBe(-32766);
    expect(triwave8(64)).toBe(128);
    expect(cubicwave8(0)).toBe(0);
    expect(scale8(255, 128)).toBe(128);
  });
});

describe("palettes", () => {
  it("loads built-in gradients like WLED", () => {
    // Sunset_Real (13): WLED main stores it starting at 181,0,0.
    const p = gradientPalette(GRADIENT_PALETTES[0]!);
    expect(p[0]! & 0xffffff).toBe(0xb50000);
  });

  it("loads a library palette as the controller loads palette files", () => {
    const p = stopsToPalette16([
      { pos: 0, color: "#000000" },
      { pos: 255, color: "#ffffff" },
    ]);
    expect(p[0]).toBe(0);
    expect(p[15]! & 0xffffff).toBe(0xffffff);
    expect(ColorFromPalette(p, 128, 255, LINEARBLEND) & 0xff).toBeGreaterThan(100);
  });

  it("parses WLED colors", () => {
    expect(wledColorToInt([255, 0, 16])).toBe(0xff0010);
    expect(wledColorToInt([0, 0, 0, 200]) >>> 24).toBe(200);
    expect(wledColorToInt("00ff00")).toBe(0x00ff00);
  });
});

describe("effect metadata", () => {
  it("has a name and metadata for every simulated effect", () => {
    for (const id of SIM_EFFECTS.keys()) expect(FX_METADATA[id], `effect ${id}`).toBeDefined();
    const cat = simCatalog();
    expect(cat.effects[0]).toBe("Solid");
    expect(cat.effects[65]).toBe("Palette");
    expect(cat.fxdata[65]).toContain("Animate Shift");
    expect(cat.effects[122]).toBe(""); // 2D-only: not simulated
  });

  it("reads slider defaults", () => {
    expect(effectDefaults(65)).toMatchObject({ ix: 112, c1: 0, o1: true, o2: false, o3: true });
    expect(effectDefaults(38)).toMatchObject({ sx: 24, pal: 50 });
  });
});

describe("Simulator", () => {
  const solid = (seg: PresetState["seg"][number]): PresetState => ({ bri: 255, seg: [{ fx: 0, col: [[255, 0, 0]], ...seg }] });

  it("fills a solid segment and leaves the rest of the strip dark", () => {
    const sim = new Simulator(10);
    sim.apply(solid({ start: 2, stop: 5 }), noPalettes);
    const px = run(sim, 1);
    expect([...px]).toEqual([0, 0, 0xff0000, 0xff0000, 0xff0000, 0, 0, 0, 0, 0]);
  });

  it("applies grouping, spacing and reverse", () => {
    const sim = new Simulator(8);
    // Percent at 50% lights the first half of the virtual pixels; grouped by 2 with 1 gap.
    sim.apply({ bri: 255, seg: [{ fx: 98, ix: 50, sx: 255, col: [[0, 0, 255], [0, 0, 0]], pal: 0, grp: 2, spc: 1 }] }, noPalettes);
    const px = run(sim, 5);
    // vLength = ceil(8/3) = 3; 50% -> 2 lit: LEDs 0,1 and 3,4; LEDs 2,5 are gaps; 6,7 unlit.
    expect([...px].map((c) => (c ? 1 : 0))).toEqual([1, 1, 0, 1, 1, 0, 0, 0]);
    sim.apply({ bri: 255, seg: [{ fx: 98, ix: 50, sx: 255, col: [[0, 0, 255], [0, 0, 0]], pal: 0, grp: 2, spc: 1, rev: true }] }, noPalettes);
    expect([...run(sim, 5, 200)].map((c) => (c ? 1 : 0))).toEqual([0, 0, 0, 1, 1, 0, 1, 1]);
  });

  it("blends segments with their blend mode and opacity", () => {
    const sim = new Simulator(4);
    const base = { fx: 0, start: 0, stop: 4 };
    sim.apply({ bri: 255, seg: [{ ...base, col: [[200, 100, 50]] }, { ...base, col: [[128, 255, 0]], bm: 6 }] }, noPalettes);
    // multiply: (a*b)/255
    expect(run(sim, 1)[0]).toBe(((100 << 16) | (100 << 8) | 0) >>> 0);
    sim.apply({ bri: 255, seg: [{ ...base, col: [[0, 0, 0]] }, { ...base, col: [[255, 255, 255]], bri: 0 }] }, noPalettes);
    expect(run(sim, 1, 50)[0]).toBe(0);
  });

  it("explains how an LED got its color", () => {
    const sim = new Simulator(6);
    sim.apply(
      {
        bri: 200,
        seg: [
          { fx: 0, start: 0, stop: 6, col: [[200, 100, 50]] },
          { stop: 0 }, // cleared slot: not simulated, but positions still count it
          { fx: 0, start: 0, stop: 6, col: [[128, 255, 0]], bm: 6, spc: 1 },
          { fx: 0, start: 0, stop: 3, col: [[0, 0, 255]], on: false },
        ],
      },
      noPalettes,
    );
    const px = run(sim, 1);
    const lit = sim.explain(0);
    expect(lit.color).toBe(px[0]);
    expect(lit.brightness).toBe(200);
    expect(lit.layers.map((l) => [l.segment, l.status])).toEqual([[0, "lit"], [2, "lit"], [3, "off"]]);
    const top = lit.layers[1]!.writes[0]!;
    expect(top).toMatchObject({ pixel: 0, color: 0x80ff00, mode: 6, below: 0xc86432, blended: (100 << 16) | (100 << 8), result: px[0] });
    // Spacing 1: LED 1 is the gap after segment 2's first pixel.
    expect(sim.explain(1).layers.map((l) => l.status)).toEqual(["lit", "gap", "off"]);
    expect(sim.explain(4).layers.map((l) => l.segment)).toEqual([0, 2]);
  });

  it("keeps effect state across edits and restarts when the effect changes", () => {
    const sim = new Simulator(30);
    sim.apply({ seg: [{ fx: 3 }] }, noPalettes);
    run(sim, 10);
    const seg = sim.strip.segments[0]!;
    expect(seg.call).toBeGreaterThan(0);
    sim.apply({ seg: [{ fx: 3, sx: 10 }] }, noPalettes);
    expect(seg.reset).toBe(false);
    sim.apply({ seg: [{ fx: 9 }] }, noPalettes);
    expect(seg.reset).toBe(true);
  });

  it("uses library palettes for segments that reference them", () => {
    const sim = new Simulator(16);
    const green = stopsToPalette16([
      { pos: 0, color: "#00ff00" },
      { pos: 255, color: "#00ff00" },
    ]);
    sim.apply({ bri: 255, seg: [{ fx: 65, sx: 0, c1: 0, o1: false, pal: { paletteId: "g" } }] }, (id) => (id === "g" ? green : null));
    for (const c of run(sim, 2)) expect(c & 0xffffff).toBe(0x00ff00);
  });

  it("runs every effect without throwing at any length or setting", () => {
    for (const id of SIM_EFFECTS.keys()) {
      for (const length of [1, 2, 7, 64, 300]) {
        for (const v of [0, 128, 255]) {
          const sim = new Simulator(length);
          const seg = { fx: id, sx: v, ix: v, c1: v, c2: v, c3: v >> 3, o1: v > 0, o2: v > 128, o3: v > 128, pal: v === 255 ? 1 : v === 128 ? 11 : 0 };
          sim.apply({ bri: 255, seg: [seg] }, noPalettes);
          expect(() => run(sim, 120, 1000 * v), `effect ${id} (${FX_METADATA[id]?.split("@")[0]}) len ${length} v ${v}`).not.toThrow();
        }
      }
    }
  });

  it("lights LEDs with almost every effect", () => {
    const dark: string[] = [];
    // Copy Segment needs a second segment; Sunrise starts black and brightens over the selected minutes.
    for (const id of [...SIM_EFFECTS.keys()].filter((id) => id !== 77 && id !== 104)) {
      const sim = new Simulator(60);
      sim.apply({ bri: 255, seg: [{ fx: id }] }, noPalettes);
      let lit = false;
      for (let f = 0; f < 400 && !lit; f++) lit = sim.frame(f * 23).some((c) => c !== 0);
      if (!lit) dark.push(`${id} ${FX_METADATA[id]?.split("@")[0]}`);
    }
    expect(dark).toEqual([]);
  });
});
