import { describe, expect, it } from "vitest";
import { canonicalJson, importPreset, isStatePreset, renderPreset } from "./presets.js";

const effects = ["Solid", "Blink", "Breathe"];

// Shapes seen on real devices.
const statePreset = {
  on: true,
  bri: 95,
  transition: 7,
  mainseg: 0,
  seg: [
    { id: 0, start: 0, stop: 590, grp: 1, spc: 2, col: [[255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0]], fx: 2, pal: 255, n: "" },
    { id: 1, start: 1, stop: 590, grp: 2, fx: 0, pal: 6 },
    { stop: 0 },
  ],
  n: "Warm",
  ql: "W",
};
const apiPreset = { win: "T=0", n: "Off" };
const perLedPreset = { seg: { i: [68, [0, 0, 0, 17], 67, [0, 0, 0, 63]] }, n: "Fade" };
const playlist = { playlist: { ps: [1, 2], dur: [100, 100], transition: [7, 7], repeat: 0 }, n: "Cycle" };

describe("isStatePreset", () => {
  it("classifies device preset shapes", () => {
    expect(isStatePreset(statePreset)).toBe(true);
    expect(isStatePreset(apiPreset)).toBe(false);
    expect(isStatePreset(perLedPreset)).toBe(false);
    expect(isStatePreset(playlist)).toBe(false);
  });
});

describe("importPreset / renderPreset", () => {
  const libraryPalette = (id: number) => (id === 255 ? "lib-red" : undefined);

  it("imports a state preset, linking custom palettes and recording effect names", () => {
    const p = importPreset(2, statePreset, { effects, libraryPalette });
    expect(p).toMatchObject({ slot: 2, name: "Warm", ql: "W", kind: "state" });
    expect(p.state!.seg[0]).toMatchObject({ pal: { paletteId: "lib-red" }, fxName: "Breathe", grp: 1, spc: 2 });
    expect(p.state!.seg[1]).toMatchObject({ pal: 6, fxName: "Solid" });
    expect(p.state!.seg[2]).toEqual({ stop: 0 });
    expect(p.state).not.toHaveProperty("n");
  });

  it("round-trips every shape to identical device JSON", () => {
    for (const [slot, device] of [statePreset, apiPreset, perLedPreset, playlist].entries()) {
      const imported = importPreset(slot + 1, device, { effects, libraryPalette });
      const { json, warnings } = renderPreset(imported, { effects, devicePalette: (id) => (id === "lib-red" ? 255 : undefined) });
      expect(warnings).toEqual([]);
      expect(canonicalJson(json)).toBe(canonicalJson(device));
    }
  });

  it("renders for a device with different palette slots and effect numbering", () => {
    const imported = importPreset(2, statePreset, { effects, libraryPalette });
    const { json } = renderPreset(imported, {
      effects: ["Solid", "Breathe", "Blink"],
      devicePalette: (id) => (id === "lib-red" ? 198 : undefined),
    });
    const seg = json.seg as Record<string, unknown>[];
    expect(seg[0]).toMatchObject({ fx: 1, pal: 198 });
    expect(seg[0]).not.toHaveProperty("fxName");
  });

  it("warns about missing effects and palettes", () => {
    const imported = importPreset(2, statePreset, { effects, libraryPalette });
    const { json, warnings } = renderPreset(imported, {
      effects: ["Solid"],
      devicePalette: () => undefined,
      paletteName: () => "Red",
    });
    expect((json.seg as Record<string, unknown>[])[0]!.pal).toBe(0);
    expect(warnings).toEqual([`effect "Breathe" isn't available on this controller`, `palette "Red" isn't on this controller; using Default`]);
  });

  it("takes defined segments' LEDs, direction and name from the target controller", () => {
    const preset = {
      slot: 1,
      name: "Roof",
      kind: "state" as const,
      state: {
        seg: [
          { sid: "gone", start: 20, stop: 30, fx: 0 },
          { sid: "roof", start: 0, stop: 10, n: "Old", grp: 2, fx: 0 },
          { fx: 1 },
        ],
      },
    };
    const ctx = {
      effects,
      devicePalette: () => undefined,
      segment: (sid: string) =>
        sid === "roof"
          ? ({ ok: true, segment: { name: "Roofline", start: 100, stop: 150, rev: true }, definition: { id: "roof", start: 100, end: { type: "length", count: 50 } }, byName: false } as const)
          : ({ ok: false, error: "its defined segment was deleted" } as const),
    };
    const { json, warnings } = renderPreset(preset, ctx);
    // The segment whose definition is missing is left out; the others keep their IDs.
    expect(json.seg).toEqual([
      { id: 1, start: 100, stop: 150, rev: true, n: "Roofline", grp: 2, fx: 0 },
      { id: 2, fx: 1 },
    ]);
    expect(warnings).toEqual(["segment 0 left out: its defined segment was deleted"]);

    // A preset that turns other segments off turns the left-out one off as well.
    const clearing = { ...preset, state: { seg: [...preset.state.seg, { stop: 0 }] } };
    expect(renderPreset(clearing, ctx).json.seg).toEqual([
      { id: 0, stop: 0 },
      { id: 1, start: 100, stop: 150, rev: true, n: "Roofline", grp: 2, fx: 0 },
      { id: 2, fx: 1 },
      { id: 3, stop: 0 },
    ]);
  });

  it("puts grouped segments in WLED segment sets", () => {
    const preset = {
      slot: 1,
      name: "P",
      kind: "state" as const,
      state: { seg: [{ id: 0, fx: 1 }, { id: 1, fx: 2, set: 2 }, { id: 2, fx: 3 }, { id: 3, stop: 0 }] },
      groups: [{ name: "Windows", members: [0, 2] }],
    };
    const ctx = { effects, devicePalette: () => undefined };
    expect(renderPreset(preset, ctx).json.seg).toEqual([
      { id: 0, fx: 1, set: 1 },
      { id: 1, fx: 2, set: 0 },
      { id: 2, fx: 3, set: 1 },
      { id: 3, stop: 0 },
    ]);
    // Without groups, sets stay as saved (e.g. from an imported preset).
    expect(renderPreset({ ...preset, groups: undefined }, ctx).json.seg).toEqual(preset.state.seg);
  });

  it("warns about segments sharing an ID", () => {
    const preset = { slot: 1, name: "P", kind: "state" as const, state: { seg: [{ id: 1 }, { id: 4 }, { id: 4 }, { fx: 1 }] } };
    expect(renderPreset(preset, { effects, devicePalette: () => undefined }).warnings).toEqual([
      "segment ID 4 used more than once; only the last of each is applied",
    ]);
  });

  it("names unnamed presets by slot", () => {
    expect(importPreset(7, { seg: [] }, { effects, libraryPalette }).name).toBe("Preset 7");
  });
});

describe("canonicalJson", () => {
  it("ignores key order but not array order", () => {
    expect(canonicalJson({ a: 1, b: { d: 1, c: 2 } })).toBe(canonicalJson({ b: { c: 2, d: 1 }, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
