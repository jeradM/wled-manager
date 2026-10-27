import { afterEach, describe, expect, it } from "vitest";
import type { Controller, PresetInput } from "@wled-manager/shared";
import { createTestApp, startMock } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
const mocks: Awaited<ReturnType<typeof startMock>>[] = [];
afterEach(async () => {
  await t.cleanup();
  await Promise.all(mocks.splice(0).map((m) => m.stop()));
});

async function addController(name: string, ledCount: number) {
  const mock = await startMock({ name, ledCount });
  mocks.push(mock);
  const c = (
    await t.app.inject({ method: "POST", url: "/api/controllers", payload: { name, host: mock.host, port: mock.port } })
  ).json<Controller>();
  return { mock, c };
}

describe("defined segments in presets", () => {
  it("are resolved per controller when syncing, by ID or by name", async () => {
    t = await createTestApp();
    const a = await addController("A", 100);
    const b = await addController("B", 50);
    await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${a.c.id}`,
      payload: { markers: [{ index: 20, label: "Corner" }], segments: [{ id: "roof", name: "Roof", start: "Corner", end: { type: "length", count: 30 } }] },
    });
    await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${b.c.id}`,
      payload: { segments: [{ id: "b-roof", name: "Roof", start: 40, end: { type: "led", index: 10, includeEnd: true } }] },
    });
    const preset: PresetInput = {
      slot: 1,
      name: "P",
      kind: "state",
      // Saved LEDs are a stale copy; the definition decides.
      state: { seg: [{ id: 0, sid: "roof", start: 0, stop: 5, grp: 2, spc: 1, fx: 0 }] },
    };
    await t.app.inject({ method: "POST", url: "/api/presets", payload: preset });

    for (const { c } of [a, b]) await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/sync` });
    const synced = (m: (typeof mocks)[number]) => JSON.parse(m.files.get("/presets.json")!)["1"].seg[0];
    expect(synced(a.mock)).toEqual({ id: 0, start: 20, stop: 50, rev: false, n: "Roof", grp: 2, spc: 1, fx: 0 });
    expect(synced(b.mock)).toEqual({ id: 0, start: 10, stop: 41, rev: true, n: "Roof", grp: 2, spc: 1, fx: 0 });

    // Moving the marker moves the preset's segment: the next sync has a change to apply.
    await t.app.inject({ method: "PATCH", url: `/api/controllers/${a.c.id}`, payload: { markers: [{ index: 60, label: "Corner" }] } });
    const plan = (await t.app.inject({ method: "GET", url: `/api/controllers/${a.c.id}/sync-plan` })).json();
    expect(plan.presets[0]).toMatchObject({ slot: 1, action: "update" });
  });
});

describe("which controllers a preset syncs to", () => {
  it("skips controllers without the preset's segments, or not chosen for it", async () => {
    t = await createTestApp();
    const a = await addController("A", 100);
    const b = await addController("B", 50);
    await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${a.c.id}`,
      payload: { segments: [{ id: "roof", name: "Roof", start: 0, end: { type: "length", count: 10 } }] },
    });
    const post = (payload: PresetInput) => t.app.inject({ method: "POST", url: "/api/presets", payload });
    await post({ slot: 1, name: "Roof only", kind: "state", state: { seg: [{ id: 0, sid: "roof", fx: 0 }] } });
    const chosen = await post({ slot: 2, name: "B only", kind: "state", state: { seg: [{ fx: 1 }] }, controllers: [b.c.id] });
    expect(chosen.json().controllers).toEqual([b.c.id]);
    await post({ slot: 3, name: "Everywhere", kind: "state", state: { seg: [{ fx: 2 }] } });

    const slots = async (m: (typeof mocks)[number], c: Controller) => {
      await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/sync` });
      return Object.keys(JSON.parse(m.files.get("/presets.json")!)).filter((k) => k !== "0");
    };
    expect(await slots(a.mock, a.c)).toEqual(["1", "3"]);
    expect(await slots(b.mock, b.c)).toEqual(["2", "3"]);
    const plan = (await t.app.inject({ method: "GET", url: `/api/controllers/${b.c.id}/sync-plan` })).json();
    expect(plan.skippedPresets).toEqual([
      { presetId: expect.any(String), slot: 1, name: "Roof only", reason: "none of its segments are defined on this controller" },
    ]);

    // Defining the segment on B (by name) brings the preset there.
    await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${b.c.id}`,
      payload: { segments: [{ id: "b-roof", name: "Roof", start: 20, end: { type: "length", count: 5 } }] },
    });
    expect(await slots(b.mock, b.c)).toEqual(["1", "2", "3"]);
  });
});
