import { describe, expect, it } from "vitest";
import type { Segment, SegmentDefinition } from "./schemas.js";
import {
  applyGroupEdit,
  indicesToSpans,
  joinGroup,
  linkSegment,
  litLeds,
  presetSkipReason,
  segmentSets,
  renumberSegments,
  moveSegment,
  overlappingSegments,
  removeGroupMember,
  resolveSegment,
  resolveSegmentRef,
  setClearOthers,
  virtualLength,
  withSettingsOf,
  type SegmentSource,
} from "./segments.js";

const markers = [
  { index: 0, label: "Start" },
  { index: 100, label: "Corner" },
  { index: 250, label: "Door" },
];
const ranges = [
  { label: "Roof", spans: [{ start: 10, stop: 40 }] },
  { label: "Posts", spans: [{ start: 50, stop: 55 }, { start: 80, stop: 85 }] },
];
type Geometry = SegmentDefinition extends infer D ? (D extends unknown ? Omit<D, "id"> : never) : never;
const resolve = (entry: Geometry) => resolveSegment({ id: "x", ...entry } as SegmentDefinition, { markers, ranges, ledCount: 300 });
const toMarker = (label: string, includeEnd = false) => ({ type: "marker" as const, label, includeEnd });

describe("resolveSegment", () => {
  it("runs up to the LED before the end marker", () => {
    expect(resolve({ start: "Start", end: toMarker("Corner") })).toEqual({
      ok: true,
      segment: { start: 0, stop: 100, rev: false },
    });
  });

  it("can include the end marker's LED", () => {
    expect(resolve({ start: "Corner", end: toMarker("Door", true), name: "Side" })).toEqual({
      ok: true,
      segment: { name: "Side", start: 100, stop: 251, rev: false },
    });
  });

  it("reverses when the end marker comes first", () => {
    expect(resolve({ start: "Door", end: toMarker("Corner") })).toEqual({
      ok: true,
      segment: { start: 101, stop: 251, rev: true },
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
    expect(resolve({ range: "Roof", span: 0, reverse: false })).toEqual({ ok: true, segment: { start: 10, stop: 40, rev: false } });
    expect(resolve({ range: "Posts", span: 1, reverse: true })).toEqual({ ok: true, segment: { start: 80, stop: 85, rev: true } });
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
    const a = { start: 0, stop: 100, rev: false };
    const b = { start: 100, stop: 200, rev: false };
    const c = { start: 150, stop: 160, rev: true };
    expect(overlappingSegments([a, b, undefined, c])).toEqual([[1, 3]]);
  });
});

describe("defined segments in presets", () => {
  const roofA: SegmentDefinition = { id: "a1", name: "Roof", range: "Roof", span: 0, reverse: false };
  const door: SegmentDefinition = { id: "a2", start: "Door", end: { type: "length", count: -10 } };
  const a: SegmentSource = { id: "A", segments: [roofA, door], markers, ranges, device: { ledCount: 300 } };
  const b: SegmentSource = {
    id: "B",
    segments: [{ id: "b1", name: "roof", start: 5, end: { type: "length", count: 5 } }],
    markers: [],
    ranges: [],
    device: { ledCount: 50 },
  };
  const all = [a, b];

  it("resolves a definition on its own controller", () => {
    expect(resolveSegmentRef("a2", a, all)).toEqual({ ok: true, segment: { start: 241, stop: 251, rev: true }, definition: door, byName: false });
  });

  it("uses the segment of the same name on other controllers", () => {
    expect(resolveSegmentRef("a1", b, all)).toMatchObject({ ok: true, segment: { name: "roof", start: 5, stop: 10 }, byName: true });
    expect(resolveSegmentRef("a2", b, all)).toEqual({ ok: false, error: "it uses an unnamed segment defined on another controller" });
    expect(resolveSegmentRef("gone", a, all)).toEqual({ ok: false, error: "its defined segment was deleted" });
    expect(resolveSegmentRef("b1", { ...a, segments: [door] }, all)).toEqual({
      ok: false,
      error: 'this controller has no segment named "roof"',
    });
  });

  it("reports definitions that no longer fit", () => {
    expect(resolveSegmentRef("a1", { ...a, ranges: [] }, all)).toEqual({ ok: false, error: 'Roof: No range labelled "Roof"' });
  });

  it("links a preset segment: geometry and name from the definition, everything else kept", () => {
    const seg: Segment = { id: 3, fx: 9, grp: 2, start: 0, stop: 5, n: "old" };
    expect(linkSegment(seg, "a1", { name: "Roof", start: 10, stop: 40, rev: true })).toEqual({
      id: 3, fx: 9, grp: 2, sid: "a1", start: 10, stop: 40, rev: true, n: "Roof",
    });
    expect(linkSegment(seg, "a2", { start: 1, stop: 2, rev: false })).not.toHaveProperty("n");
  });
});

describe("which controllers a preset syncs to", () => {
  const def: SegmentDefinition = { id: "d", name: "Roof", start: 0, end: { type: "length", count: 5 } };
  const a: SegmentSource = { id: "A", segments: [def], markers: [], ranges: [], device: { ledCount: 50 } };
  const b: SegmentSource = { id: "B", segments: [], markers: [], ranges: [], device: { ledCount: 50 } };
  const all = [a, b];
  const preset = (seg: Segment[], controllers?: string[]) => ({ kind: "state" as const, state: { seg }, controllers });

  it("syncs a preset using defined segments only where one of them is defined", () => {
    const p = preset([{ sid: "d" }, { fx: 1 }]);
    expect(presetSkipReason(p, a, all)).toBeUndefined();
    expect(presetSkipReason(p, b, all)).toBe("none of its segments are defined on this controller");
    expect(presetSkipReason(preset([{ fx: 1 }]), b, all)).toBeUndefined();
    expect(presetSkipReason({ kind: "raw" }, b, all)).toBeUndefined();
  });

  it("honours the preset's chosen controllers", () => {
    expect(presetSkipReason(preset([{ fx: 1 }], ["A"]), b, all)).toBe("not chosen for this controller");
    expect(presetSkipReason(preset([{ fx: 1 }], ["A"]), a, all)).toBeUndefined();
  });
});

describe("WLED segment sets from groups", () => {
  const seg: Segment[] = [{ fx: 0 }, { fx: 1 }, { fx: 2 }, { fx: 3 }, { fx: 4 }, { stop: 0 }];
  const g = (...members: number[][]) => members.map((m, k) => ({ name: `G${k}`, members: m }));

  it("keeps set 0 for ungrouped segments and puts groups in sets 1–3, extras sharing set 3", () => {
    expect(segmentSets(seg, g([1], [2], [3], [4]))).toEqual([0, 1, 2, 3, 3, undefined]);
  });

  it("uses all four sets when every segment is grouped", () => {
    expect(segmentSets(seg, g([0], [1, 2], [3], [4]))).toEqual([0, 1, 1, 2, 3, undefined]);
    expect(segmentSets(seg, g([0], [1], [2], [3], [4]))).toEqual([0, 1, 2, 3, 3, undefined]);
  });

  it("leaves presets without groups alone", () => {
    expect(segmentSets(seg, undefined)).toBeUndefined();
    expect(segmentSets(seg, [])).toBeUndefined();
  });
});

describe("renumbering segments", () => {
  it("makes IDs match positions so none repeat, keeping the main segment", () => {
    const state = { mainseg: 3, seg: [{ id: 1, fx: 1 }, { id: 4, fx: 2 }, { id: 3, fx: 3 }, { id: 4, fx: 4 }, { stop: 0 }] };
    expect(renumberSegments(state)).toEqual({
      mainseg: 2,
      seg: [{ id: 0, fx: 1 }, { id: 1, fx: 2 }, { id: 2, fx: 3 }, { id: 3, fx: 4 }, { id: 4, stop: 0 }],
    });
  });
});

describe("turning other segments off", () => {
  const state = { mainseg: 3, seg: [{ id: 0, fx: 1 }, { stop: 0 }, { stop: 0 }, { id: 3, fx: 2 }] };
  const groups = [{ name: "G", members: [3] }];

  it("drops clear markers, moving real segments to the front", () => {
    const off = setClearOthers(state, groups, false, 32);
    expect(off.state).toEqual({ mainseg: 1, seg: [{ id: 0, fx: 1 }, { id: 1, fx: 2 }] });
    expect(off.groups).toEqual([{ name: "G", members: [1] }]);
  });

  it("pads with clear markers up to the controller's segment limit", () => {
    const on = setClearOthers(state, groups, true, 4);
    expect(on.state.seg).toEqual([{ id: 0, fx: 1 }, { id: 1, fx: 2 }, { id: 2, stop: 0 }, { id: 3, stop: 0 }]);
  });
});

describe("moving segments and groups", () => {
  const state = {
    mainseg: 2,
    seg: [{ id: 0, fx: 10 }, { id: 1, fx: 11 }, { stop: 0 }, { id: 2, fx: 12 }, { stop: 0 }],
  };
  const groups = [{ name: "G", members: [0, 3] }];

  it("renumbers segments in the new order and keeps the main segment and groups with their segments", () => {
    // Drag segment fx 12 (position 3) onto the first segment's place.
    const moved = moveSegment(state, groups, 3, 0);
    expect(moved.state.seg).toEqual([
      { id: 0, fx: 12 },
      { id: 1, fx: 10 },
      { id: 2, fx: 11 },
      { id: 3, stop: 0 },
      { id: 4, stop: 0 },
    ]);
    expect(moved.state.mainseg).toBe(0);
    expect(moved.groups).toEqual([{ name: "G", members: [0, 1] }]);
  });

  it("moves down as well as up", () => {
    const moved = moveSegment({ seg: [{ fx: 1 }, { fx: 2 }, { fx: 3 }] }, [], 0, 2);
    expect(moved.state.seg.map((s) => s.fx)).toEqual([2, 3, 1]);
    expect(moved.state.mainseg).toBeUndefined();
  });

  it("drops removed segments from groups", () => {
    expect(removeGroupMember([{ name: "G", members: [0, 2, 3] }], 2, true)).toEqual([{ name: "G", members: [0, 2] }]);
    expect(removeGroupMember([{ name: "G", members: [0, 2, 3] }], 2, false)).toEqual([{ name: "G", members: [0, 3] }]);
  });

  it("applies only the edited fields to every group member", () => {
    const seg: Segment[] = [
      { fx: 1, col: [[1, 1, 1]], bm: 3, start: 0 },
      { fx: 2, col: [[2, 2, 2]], start: 10 },
      { fx: 3, start: 20 },
    ];
    const before = seg[0]!;
    expect(applyGroupEdit(seg, [0, 1], before, { ...before, fx: 9 })).toEqual([
      { fx: 9, col: [[1, 1, 1]], bm: 3, start: 0 },
      { fx: 9, col: [[2, 2, 2]], start: 10 },
      { fx: 3, start: 20 },
    ]);
    const { bm: _, ...withoutBm } = before;
    expect(applyGroupEdit(seg, [0, 1], before, { ...withoutBm, col: [[5, 5, 5]] })[1]).toEqual({ fx: 2, col: [[5, 5, 5]], start: 10 });
  });
});

describe("joining a group", () => {
  const seg: Segment[] = [
    { id: 0, start: 0, stop: 10, fx: 9, col: [[1, 2, 3]], pal: 4, bm: 2, grp: 2 },
    { id: 1, sid: "a", start: 10, stop: 20, rev: true, n: "Roof", fx: 0, sx: 50, frz: true },
    { id: 2, start: 20, stop: 30, fx: 3 },
  ];

  it("copies settings but keeps the segment's ID, LEDs and name", () => {
    expect(withSettingsOf(seg[1]!, seg[0]!)).toEqual({
      id: 1, sid: "a", start: 10, stop: 20, rev: true, n: "Roof", fx: 9, col: [[1, 2, 3]], pal: 4, bm: 2, grp: 2,
    });
  });

  it("takes on the group's settings when joining", () => {
    const groups = [{ name: "G", members: [0, 2] }];
    const out = joinGroup(seg, groups, 1, 0);
    expect(out.groups).toEqual([{ name: "G", members: [0, 1, 2] }]);
    expect(out.seg[1]).toEqual({ ...withSettingsOf(seg[1]!, seg[0]!) });
    expect(out.seg[0]).toBe(seg[0]);
  });

  it("leaves settings alone when the group is empty, already holds it, or when leaving", () => {
    expect(joinGroup(seg, [{ name: "G", members: [] }], 1, 0)).toEqual({ seg, groups: [{ name: "G", members: [1] }] });
    const groups = [{ name: "G", members: [0, 1] }];
    expect(joinGroup(seg, groups, 1, 0)).toEqual({ seg, groups });
    expect(joinGroup(seg, groups, 1, null)).toEqual({ seg, groups: [{ name: "G", members: [0] }] });
  });

  it("uses the new group's members, not its own, when switching groups", () => {
    const groups = [{ name: "A", members: [0, 1] }, { name: "B", members: [2] }];
    const out = joinGroup(seg, groups, 0, 1);
    expect(out.groups).toEqual([{ name: "A", members: [1] }, { name: "B", members: [0, 2] }]);
    expect(out.seg[0]).toEqual({ id: 0, start: 0, stop: 10, fx: 3 });
  });
});
