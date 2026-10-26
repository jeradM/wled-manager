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
