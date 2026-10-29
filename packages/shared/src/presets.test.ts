import { describe, expect, it } from "vitest";
import { canonicalJson, importPreset, isStatePreset, presetPaletteIds, renderPreset } from "./presets.js";
import { presetState } from "./schemas.js";
import { expandLayers, keepPadding, segmentLayers, withLayers } from "./layers.js";

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

describe("layers", () => {
  const ctx = { effects, devicePalette: (id: string) => (id === "lib-red" ? 255 : undefined) };
  const libraryPalette = (id: number) => (id === 255 ? "lib-red" : undefined);
  const layered = {
    slot: 3,
    name: "Layered",
    kind: "state" as const,
    state: {
      mainseg: 1,
      seg: [
        { id: 0, start: 0, stop: 10, fx: 0, col: [[255, 0, 0]] as [number, number, number][] },
        {
          id: 1,
          start: 10,
          stop: 20,
          n: "Roof",
          fxName: "Solid",
          layers: [
            { fxName: "Breathe", bm: 6, bri: 128 },
            { fx: 1, pal: { paletteId: "lib-red" } },
          ],
        },
        { id: 2, stop: 0 },
        { id: 3, stop: 0 },
        { id: 4, stop: 0 },
      ],
    },
    groups: [{ name: "G", members: [1] }],
  };

  it("renders each layer as a WLED segment on the segment's LEDs, numbered in order", () => {
    const { json, warnings } = renderPreset(layered, ctx);
    expect(warnings).toEqual([]);
    expect(json.seg).toEqual([
      { id: 0, start: 0, stop: 10, fx: 0, col: [[255, 0, 0]], set: 0 },
      { id: 1, start: 10, stop: 20, n: "Roof", fx: 0, set: 1 },
      { id: 2, start: 10, stop: 20, n: "Roof", fx: 2, bm: 6, bri: 128, set: 1 },
      { id: 3, start: 10, stop: 20, n: "Roof", fx: 1, pal: 255, set: 1 },
      { id: 4, stop: 0 },
      { id: 5, stop: 0 },
      { id: 6, stop: 0 },
    ]);
    expect(json.mainseg).toBe(1);
  });

  it("leaves out every layer of a defined segment the controller doesn't have", () => {
    const preset = { ...layered, state: { ...layered.state, seg: layered.state.seg.map((s, p) => (p === 1 ? { ...s, sid: "x" } : s)) } };
    const { json, warnings } = renderPreset(preset, { ...ctx, segment: () => ({ ok: false, error: "not defined" }) });
    expect((json.seg as { id: number; stop?: number }[]).map((s) => [s.id, s.stop])).toEqual([[0, 10], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
    expect(warnings).toEqual(["segment 1 left out: not defined"]);
  });

  it("names the layer in warnings", () => {
    const { warnings } = renderPreset(layered, { effects: ["Solid", "Blink"], devicePalette: () => undefined });
    expect(warnings[0]).toBe(`segment 1, layer 2: effect "Breathe" isn't available on this controller`);
  });

  it("imports segments stacked on the same LEDs as layers and renders them back unchanged", () => {
    const device = {
      on: true,
      seg: [
        { id: 0, start: 0, stop: 10, fx: 0, n: "Roof" },
        { id: 1, start: 0, stop: 10, fx: 2, bm: 6, n: "Roof" },
        { id: 2, start: 10, stop: 20, fx: 0 },
        { id: 3, start: 0, stop: 10, fx: 1 }, // not next to the others: stays its own segment
        { id: 4, stop: 0 },
      ],
      n: "Stack",
    };
    const p = importPreset(4, device, { effects, libraryPalette });
    expect(p.state!.seg).toHaveLength(4);
    expect(p.state!.seg[0]).toMatchObject({ n: "Roof", fx: 0, layers: [{ fx: 2, bm: 6, fxName: "Breathe" }] });
    expect(p.state!.seg[0]!.layers![0]).not.toHaveProperty("n");
    expect(canonicalJson(renderPreset(p, ctx).json)).toBe(canonicalJson(device));
    // Without IDs, positions are IDs; still the same JSON back.
    const bare = { seg: [{ start: 0, stop: 5, fx: 0 }, { start: 0, stop: 5, fx: 1 }], n: "Bare" };
    const q = importPreset(5, bare, { effects, libraryPalette });
    expect(q.state!.seg).toHaveLength(1);
    expect(canonicalJson(renderPreset(q, ctx).json)).toBe(canonicalJson(bare));
  });

  it("doesn't merge when segment IDs aren't their positions", () => {
    const device = { seg: [{ id: 0, start: 0, stop: 5 }, { id: 5, start: 0, stop: 5 }], n: "Odd" };
    expect(importPreset(6, device, { effects, libraryPalette }).state!.seg).toHaveLength(2);
  });

  it("drops the last clear markers past 32 WLED segments", () => {
    const seg = [{ fx: 0, layers: [{ fx: 1 }] }, ...Array.from({ length: 31 }, (_, k) => ({ id: k + 1, stop: 0 }))];
    const json = renderPreset({ slot: 1, name: "Full", kind: "state", state: { seg } }, ctx).json.seg as { id: number }[];
    expect(json).toHaveLength(32);
    expect(json.map((s) => s.id)).toEqual(Array.from({ length: 32 }, (_, k) => k));
  });

  it("splits a segment into layers and back", () => {
    const s = { id: 2, start: 1, stop: 9, n: "A", fx: 3, bm: 1, layers: [{ fx: 4 }] };
    expect(segmentLayers(s)).toEqual([{ fx: 3, bm: 1 }, { fx: 4 }]);
    expect(withLayers(s, [{ fx: 5 }, { fx: 3, bm: 1 }, { fx: 4 }])).toEqual({ id: 2, start: 1, stop: 9, n: "A", fx: 5, layers: [{ fx: 3, bm: 1 }, { fx: 4 }] });
    expect(withLayers(s, [{ fx: 4 }])).toEqual({ id: 2, start: 1, stop: 9, n: "A", fx: 4 });
    expect(expandLayers([s]).origin).toEqual([{ segment: 0, layer: 0 }, { segment: 0, layer: 1 }]);
  });

  it("keeps a padded preset's WLED length when layers come and go", () => {
    const before = [{ id: 0, fx: 0 }, { id: 1, stop: 0 }, { id: 2, stop: 0 }];
    const added = keepPadding(before, [{ id: 0, fx: 0, layers: [{ fx: 1 }] }, { id: 1, stop: 0 }, { id: 2, stop: 0 }]);
    expect(added).toEqual([{ id: 0, fx: 0, layers: [{ fx: 1 }] }, { id: 1, stop: 0 }]);
    expect(keepPadding(added, [{ id: 0, fx: 0 }, { id: 1, stop: 0 }])).toEqual(before);
    expect(keepPadding([{ fx: 0 }], [{ fx: 0, layers: [{ fx: 1 }] }])).toEqual([{ fx: 0, layers: [{ fx: 1 }] }]);
  });

  it("lists palettes used by any layer", () => {
    expect(presetPaletteIds(layered)).toEqual(["lib-red"]);
  });

  it("allows at most 32 WLED segments, counting layers", () => {
    const seg = Array.from({ length: 16 }, () => ({ fx: 0, layers: [{ fx: 1 }] }));
    expect(presetState.safeParse({ seg }).success).toBe(true);
    expect(presetState.safeParse({ seg: [...seg, { fx: 0 }] }).success).toBe(false);
  });
});
