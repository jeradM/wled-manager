import { describe, expect, it } from "vitest";
import { assignPaletteSlots } from "./slots.js";

describe("assignPaletteSlots", () => {
  it("assigns contiguous slots in desired order on first sync", () => {
    expect(assignPaletteSlots({}, ["a", "b", "c"], 10)).toEqual({ slots: { a: 0, b: 1, c: 2 }, overflow: [] });
  });

  it("keeps existing assignments stable and appends new palettes", () => {
    const r = assignPaletteSlots({ a: 0, b: 1, c: 2 }, ["c", "d", "a", "b"], 10);
    expect(r.slots).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });

  it("fills a hole by moving only the highest-slot palette", () => {
    const r = assignPaletteSlots({ a: 0, b: 1, c: 2, d: 3 }, ["a", "c", "d"], 10);
    expect(r.slots).toEqual({ a: 0, d: 1, c: 2 });
  });

  it("prefers a new palette for a hole when nothing is displaced", () => {
    const r = assignPaletteSlots({ a: 0, b: 1, c: 2 }, ["a", "c", "e"], 10);
    expect(r.slots).toEqual({ a: 0, e: 1, c: 2 });
  });

  it("overflows new palettes before existing ones when over capacity", () => {
    const r = assignPaletteSlots({ b: 0, c: 1 }, ["a", "b", "c"], 2);
    expect(r).toEqual({ slots: { b: 0, c: 1 }, overflow: ["a"] });
  });

  it("compacts when capacity shrinks", () => {
    const r = assignPaletteSlots({ a: 0, b: 5 }, ["a", "b"], 3);
    expect(r).toEqual({ slots: { a: 0, b: 1 }, overflow: [] });
  });
});
