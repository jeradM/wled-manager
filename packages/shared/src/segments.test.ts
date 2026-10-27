import { describe, expect, it } from "vitest";
import type { Segment, SegmentPlanEntry } from "./schemas.js";
import { applySegments, indicesToSpans, litLeds, overlappingSegments, resolveSegment, virtualLength } from "./segments.js";

const markers = [
  { index: 0, label: "Start" },
  { index: 100, label: "Corner" },
  { index: 250, label: "Door" },
];
const ranges = [
  { label: "Roof", spans: [{ start: 10, stop: 40 }] },
  { label: "Posts", spans: [{ start: 50, stop: 55 }, { start: 80, stop: 85 }] },
];
const resolve = (entry: SegmentPlanEntry) => resolveSegment(entry, { markers, ranges, ledCount: 300 });
const flat = { grp: 1, spc: 0, of: 0 };
const toMarker = (label: string, includeEnd = false) => ({ type: "marker" as const, label, includeEnd });

describe("resolveSegment", () => {
  it("runs up to the LED before the end marker", () => {
    expect(resolve({ start: "Start", end: toMarker("Corner") })).toEqual({
      ok: true,
      segment: { start: 0, stop: 100, rev: false, ...flat },
    });
  });

  it("can include the end marker's LED", () => {
    expect(resolve({ start: "Corner", end: toMarker("Door", true), name: "Side" })).toEqual({
      ok: true,
      segment: { name: "Side", start: 100, stop: 251, rev: false, ...flat },
    });
  });

  it("reverses when the end marker comes first", () => {
    expect(resolve({ start: "Door", end: toMarker("Corner") })).toEqual({
      ok: true,
      segment: { start: 101, stop: 251, rev: true, ...flat },
    });
    expect(resolve({ start: "Door", end: toMarker("Corner", true) })).toMatchObject({
      segment: { start: 100, stop: 251, rev: true },
    });
  });

  it("covers a number of LEDs from the start, either direction", () => {
    expect(resolve({ start: "Corner", end: { type: "length", count: 20 } })).toMatchObject({
      segment: { start: 100, stop: 120, rev: false },
    });
    expect(resolve({ start: "Corner", end: { type: "length", count: -20 } })).toMatchObject({
      segment: { start: 81, stop: 101, rev: true },
    });
  });

  it("accepts LED numbers for the start and end", () => {
    expect(resolve({ start: 10, end: { type: "led", index: 19, includeEnd: true } })).toMatchObject({
      segment: { start: 10, stop: 20, rev: false },
    });
    expect(resolve({ start: 10, end: { type: "led", index: 5, includeEnd: false } })).toMatchObject({
      segment: { start: 6, stop: 11, rev: true },
    });
    expect(resolve({ start: 290, end: toMarker("Door") })).toMatchObject({ segment: { start: 251, stop: 291, rev: true } });
    expect(resolve({ start: 300, end: { type: "length", count: 1 } }).ok).toBe(false);
    expect(resolve({ start: 0, end: { type: "led", index: 300, includeEnd: false } })).toMatchObject({ segment: { stop: 300 } });
    expect(resolve({ start: 0, end: { type: "led", index: 300, includeEnd: true } }).ok).toBe(false);
  });

  it("reports unknown markers, empty segments and overruns", () => {
    expect(resolve({ start: "Nope", end: toMarker("Corner") })).toEqual({ ok: false, error: 'No marker labelled "Nope"' });
    expect(resolve({ start: "Start", end: toMarker("Gone") }).ok).toBe(false);
    expect(resolve({ start: "Corner", end: toMarker("Corner") }).ok).toBe(false);
    expect(resolve({ start: "Corner", end: toMarker("Corner", true) })).toMatchObject({ segment: { start: 100, stop: 101 } });
    expect(resolve({ start: "Corner", end: { type: "length", count: 0 } }).ok).toBe(false);
    expect(resolve({ start: "Door", end: { type: "length", count: 51 } }).ok).toBe(false);
    expect(resolve({ start: "Door", end: { type: "length", count: 50 } }).ok).toBe(true);
    expect(resolve({ start: "Start", end: { type: "length", count: -2 } }).ok).toBe(false);
  });
});

describe("ranges, grouping and spacing", () => {
  it("resolves a part of a labelled range, optionally reversed", () => {
    expect(resolve({ range: "Roof", span: 0, reverse: false })).toEqual({ ok: true, segment: { start: 10, stop: 40, rev: false, ...flat } });
    expect(resolve({ range: "Posts", span: 1, reverse: true, grp: 2, spc: 1 })).toEqual({
      ok: true,
      segment: { start: 80, stop: 85, rev: true, grp: 2, spc: 1, of: 0 },
    });
    expect(resolve({ range: "Posts", span: 2, reverse: false })).toEqual({ ok: false, error: '"Posts" no longer has a part 3' });
    expect(resolve({ range: "Gone", span: 0, reverse: false }).ok).toBe(false);
  });

  it("works out which LEDs are lit and how many pixels the effect sees", () => {
    const s = { start: 10, stop: 20, grp: 2, spc: 1 };
    expect(litLeds(s)).toEqual([10, 11, 13, 14, 16, 17, 19]);
    expect(virtualLength(s)).toBe(4);
    expect(virtualLength({ start: 0, stop: 10, grp: 1, spc: 0 })).toBe(10);
  });

  it("turns LED selections into runs", () => {
    expect(indicesToSpans([5, 3, 4, 9, 10, 4])).toEqual([{ start: 3, stop: 6 }, { start: 9, stop: 11 }]);
    expect(indicesToSpans([])).toEqual([]);
  });
});

describe("overlappingSegments", () => {
  it("finds segments sharing LEDs", () => {
    const a = { start: 0, stop: 100, rev: false, ...flat };
    const b = { start: 100, stop: 200, rev: false, ...flat };
    const c = { start: 150, stop: 160, rev: true, ...flat };
    expect(overlappingSegments([a, b, undefined, c])).toEqual([[1, 3]]);
  });
});

describe("applySegments", () => {
  const template: Segment = { fx: 0, col: [[255, 0, 0]] };
  const state = {
    on: true,
    mainseg: 2,
    seg: [
      { id: 0, start: 0, stop: 300, fx: 9, n: "Old", grp: 2 },
      { id: 1, start: 5, stop: 10, fx: 3 },
      { id: 2, start: 10, stop: 20, fx: 4 },
      { stop: 0 },
    ],
  };

  it("keeps effect settings by position, adds new segments from the template and drops the rest", () => {
    const next = applySegments(
      state,
      [
        { name: "Roof", start: 0, stop: 100, rev: false, ...flat },
        { start: 100, stop: 200, rev: true, grp: 3, spc: 1, of: 2 },
      ],
      { template },
    );
    expect(next).toEqual({
      on: true,
      seg: [
        { id: 0, start: 0, stop: 100, rev: false, fx: 9, grp: 1, spc: 0, of: 0, n: "Roof" },
        { id: 1, start: 100, stop: 200, rev: true, fx: 3, grp: 3, spc: 1, of: 2 },
      ],
    });
  });

  it("pads with clear markers and keeps a main segment that still exists", () => {
    const next = applySegments({ ...state, mainseg: 0, seg: [] }, [{ start: 0, stop: 10, rev: false, ...flat }], {
      template,
      clearOthersUpTo: 4,
    });
    expect(next.mainseg).toBe(0);
    expect(next.seg).toEqual([
      { id: 0, start: 0, stop: 10, rev: false, ...flat, fx: 0, col: [[255, 0, 0]] },
      { id: 1, stop: 0 },
      { id: 2, stop: 0 },
      { id: 3, stop: 0 },
    ]);
  });
});
