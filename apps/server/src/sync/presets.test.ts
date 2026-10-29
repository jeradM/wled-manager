import { afterEach, describe, expect, it } from "vitest";
import type { Controller, ImportPreview, Palette, Preset, PresetInput, Segment, SyncPlan } from "@wled-manager/shared";
import type { MockOptions } from "mock-wled";
import { createTestApp, startMock } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let mock: Awaited<ReturnType<typeof startMock>>;

afterEach(async () => {
  await t.cleanup();
  await mock.stop();
});

async function setup(opts: MockOptions = {}) {
  t = await createTestApp();
  mock = await startMock(opts);
  return (
    await t.app.inject({ method: "POST", url: "/api/controllers", payload: { name: "Porch", host: mock.host, port: mock.port } })
  ).json<Controller>();
}

const red = [{ pos: 0, color: "#ff0000" }, { pos: 255, color: "#000000" }];
const green = [{ pos: 0, color: "#00ff00" }, { pos: 255, color: "#000000" }];

const post = <T>(url: string, payload: object) => t.app.inject({ method: "POST", url, payload }).then((r) => r.json<T>());
const get = <T>(url: string) => t.app.inject({ method: "GET", url }).then((r) => r.json<T>());
const devicePresets = () => JSON.parse(mock.files.get("/presets.json")!);
const statePreset = (slot: number, name: string, seg: Segment[]): PresetInput => ({ slot, name, kind: "state", state: { bri: 100, seg } });

describe("preset CRUD", () => {
  it("validates payloads and enforces unique slots", async () => {
    await setup();
    const bad = await t.app.inject({ method: "POST", url: "/api/presets", payload: { slot: 1, name: "x", kind: "state" } });
    expect(bad.statusCode).toBe(400);

    const ok = await t.app.inject({ method: "POST", url: "/api/presets", payload: statePreset(1, "A", [{ fx: 0 }]) });
    expect(ok.statusCode).toBe(201);
    const dup = await t.app.inject({ method: "POST", url: "/api/presets", payload: statePreset(1, "B", [{ fx: 0 }]) });
    expect(dup.statusCode).toBe(409);

    const raw = await t.app.inject({ method: "POST", url: "/api/presets", payload: { slot: 2, name: "Off", kind: "raw", raw: { win: "T=0" } } });
    expect(raw.json<Preset>()).toMatchObject({ kind: "raw", raw: { win: "T=0" } });
    expect(raw.json<Preset>()).not.toHaveProperty("state");
  });
});

describe("preset sync", () => {
  it("writes presets.json with resolved palettes and effects, then reports in sync", async () => {
    const c = await setup();
    const pal = await post<Palette>("/api/palettes", { name: "Red", stops: red });
    await post("/api/presets", statePreset(3, "Glow", [{ fx: 99, fxName: "Breathe", pal: { paletteId: pal.id }, grp: 2 }]));
    await post("/api/presets", { slot: 1, name: "Off", ql: "0", kind: "raw", raw: { win: "T=0" } });

    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.presets.map((p) => `${p.action}:${p.slot}`)).toEqual(["create:1", "create:3"]);

    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()).toEqual({
      "0": {},
      "1": { win: "T=0", n: "Off", ql: "0" },
      "3": { bri: 100, seg: [{ fx: 2, pal: 255, grp: 2 }], n: "Glow" },
    });
    expect((await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`)).inSync).toBe(true);
  });

  it("writes a segment's layers as WLED segments on the same LEDs", async () => {
    const c = await setup();
    await post(
      "/api/presets",
      statePreset(4, "Stack", [{ id: 0, start: 0, stop: 30, fx: 0, layers: [{ fx: 99, fxName: "Breathe", bm: 6, bri: 128 }] }, { id: 1, start: 30, stop: 60, fx: 0 }]),
    );
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()["4"]).toEqual({
      bri: 100,
      seg: [
        { id: 0, start: 0, stop: 30, fx: 0 },
        { id: 1, start: 0, stop: 30, fx: 2, bm: 6, bri: 128 },
        { id: 2, start: 30, stop: 60, fx: 0 },
      ],
      n: "Stack",
    });
    expect((await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`)).inSync).toBe(true);
  });

  it("follows linked layered effects, and keeps their layers when the effect is deleted", async () => {
    const c = await setup();
    const effect = await post<{ id: string }>("/api/effects", { name: "Glow", layers: [{ fx: 0 }, { fx: 99, fxName: "Breathe", bm: 6 }] });
    const preset = await post<Preset>("/api/presets", statePreset(6, "Linked", [{ id: 0, start: 0, stop: 30, effectId: effect.id }]));
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()["6"].seg).toEqual([
      { id: 0, start: 0, stop: 30, fx: 0 },
      { id: 1, start: 0, stop: 30, fx: 2, bm: 6 },
    ]);

    // Editing the effect changes the preset on the controller.
    await t.app.inject({ method: "PUT", url: `/api/effects/${effect.id}`, payload: { name: "Glow", layers: [{ fx: 1 }] } });
    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.presets.find((p) => p.slot === 6)?.action).toBe("update");
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()["6"].seg).toEqual([{ id: 0, start: 0, stop: 30, fx: 1 }]);

    // Deleting it leaves a copy in the preset: nothing changes on the controller.
    await t.app.inject({ method: "DELETE", url: `/api/effects/${effect.id}` });
    expect((await get<Preset>(`/api/presets/${preset.id}`)).state!.seg).toEqual([{ id: 0, start: 0, stop: 30, fx: 1 }]);
    expect((await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`)).inSync).toBe(true);
  });

  it("removes device presets the library doesn't have, flagging ones it didn't write", async () => {
    const c = await setup();
    mock.files.set("/presets.json", JSON.stringify({ "0": {}, "5": { n: "Theirs", bri: 1 } }));
    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.presets).toEqual([{ action: "delete", slot: 5, name: "Theirs", replacesUnmanaged: true }]);
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()).toEqual({ "0": {} });
  });

  it("updates presets when a palette they use moves to another slot", async () => {
    const c = await setup();
    const r = await post<Palette>("/api/palettes", { name: "Red", stops: red });
    const g = await post<Palette>("/api/palettes", { name: "Green", stops: green });
    await post("/api/presets", statePreset(1, "Uses green", [{ pal: { paletteId: g.id } }]));
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()["1"].seg[0].pal).toBe(254);

    await t.app.inject({ method: "DELETE", url: `/api/palettes/${r.id}` });
    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.presets.map((p) => p.action)).toEqual(["update"]);
    expect(plan.presets[0]!.replacesUnmanaged).toBeUndefined();
    await post(`/api/controllers/${c.id}/sync`, {});
    expect(devicePresets()["1"].seg[0].pal).toBe(255);
  });

  it("warns about presets using effects the controller lacks", async () => {
    const c = await setup();
    await post("/api/presets", statePreset(1, "Fancy", [{ fx: 150, fxName: "Not An Effect" }]));
    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.presets[0]!.warnings).toEqual([`effect "Not An Effect" isn't available on this controller`]);
  });

  it("tests a preset on the device without storing it", async () => {
    const c = await setup();
    const res = await post<{ warnings: string[] }>(
      `/api/controllers/${c.id}/preset-test`,
      statePreset(9, "Try", [{ fx: 1, fxName: "Blink", sx: 200 }]),
    );
    expect(res.warnings).toEqual([]);
    expect(mock.getState()).toMatchObject({ bri: 100, seg: [{ fx: 1, sx: 200 }] });
    expect(mock.getState()).not.toHaveProperty("n");
    expect(devicePresets()).toEqual({ "0": {} });
  });
});

describe("import", () => {
  const deviceFiles = () => {
    mock.files.set("/palette0.json", JSON.stringify({ palette: [0, "ff0000", 255, "000000"] }));
    mock.files.set("/palette1.json", JSON.stringify({ palette: [0, "00ff00", 255, "000000"] }));
    mock.files.set(
      "/presets.json",
      JSON.stringify({
        "0": {},
        "1": { on: true, bri: 90, mainseg: 0, seg: [{ id: 0, start: 0, stop: 60, fx: 2, pal: 254, col: [[255, 0, 0, 0]], grp: 1 }], n: "Green breathe", ql: "G" },
        "2": { win: "T=0", n: "Off" },
        "3": { seg: { i: [0, [255, 0, 0], 1, [0, 255, 0]] }, n: "Pixels" },
        "4": { playlist: { ps: [1, 3], dur: [100, 100], transition: [7, 7], repeat: 0 }, n: "Cycle" },
      }),
    );
  };

  it("previews what can be imported without writing to the device", async () => {
    const c = await setup();
    deviceFiles();
    await post("/api/palettes", { name: "Already here", stops: red });

    const preview = await get<ImportPreview>(`/api/controllers/${c.id}/import`);
    expect(preview.palettes.map((p) => [p.slot, p.deviceId, p.status])).toEqual([[0, 255, "in-library"], [1, 254, "new"]]);
    expect(preview.presets.map((p) => [p.slot, p.kind, p.status, p.paletteSlots])).toEqual([
      [1, "state", "new", [1]],
      [2, "raw", "new", []],
      [3, "raw", "new", []],
      [4, "raw", "new", []],
    ]);
    expect(mock.writes).toEqual([]);
  });

  it("imports everything and leaves the controller in sync", async () => {
    const c = await setup();
    deviceFiles();
    await post("/api/palettes", { name: "Already here", stops: red });

    const result = await post(`/api/controllers/${c.id}/import`, { palettes: [0, 1], presets: [1, 2, 3, 4] });
    expect(result).toEqual({ palettesCreated: 1, palettesLinked: 1, presetsImported: 4 });

    const palettes = await get<Palette[]>("/api/palettes");
    expect(palettes.map((p) => p.name)).toEqual(["Already here", "Porch #1"]);
    const presets = await get<Preset[]>("/api/presets");
    expect(presets[0]).toMatchObject({ slot: 1, name: "Green breathe", ql: "G", kind: "state" });
    expect(presets[0]!.state!.seg[0]).toMatchObject({ pal: { paletteId: palettes[1]!.id }, fxName: "Breathe" });

    const plan = await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`);
    expect(plan.inSync).toBe(true);
    expect([...plan.palettes, ...plan.presets].some((x) => x.replacesUnmanaged)).toBe(false);
    expect(mock.writes).toEqual([]);

    // A second preview now shows everything as already in the library.
    const again = await get<ImportPreview>(`/api/controllers/${c.id}/import`);
    expect(again.presets.every((p) => p.status === "identical")).toBe(true);
  });

  it("imports segments stacked on the same LEDs as layers, staying in sync", async () => {
    const c = await setup();
    mock.files.set(
      "/presets.json",
      JSON.stringify({
        "0": {},
        "5": {
          seg: [
            { id: 0, start: 0, stop: 60, fx: 0, n: "Roof" },
            { id: 1, start: 0, stop: 60, fx: 2, bm: 6, n: "Roof" },
            { id: 2, stop: 0 },
          ],
          n: "Stacked",
        },
      }),
    );
    await post(`/api/controllers/${c.id}/import`, { palettes: [], presets: [5] });
    const [p] = await get<Preset[]>("/api/presets");
    expect(p!.state!.seg).toHaveLength(2);
    expect(p!.state!.seg[0]).toMatchObject({ n: "Roof", fx: 0, layers: [{ fx: 2, bm: 6, fxName: "Breathe" }] });
    expect((await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`)).inSync).toBe(true);
    expect(mock.writes).toEqual([]);
  });

  it("imports the controller's segment sets as groups, staying in sync", async () => {
    const c = await setup();
    const device = {
      seg: [
        { id: 0, start: 0, stop: 20, fx: 0, set: 0 },
        { id: 1, start: 20, stop: 40, fx: 2, set: 1 },
        { id: 2, start: 40, stop: 60, fx: 2, set: 1 },
      ],
      n: "Grouped",
    };
    mock.files.set("/presets.json", JSON.stringify({ "0": {}, "7": device }));
    // A library preset with the same settings but no groups isn't the same: re-importing adds the groups.
    await post("/api/presets", { slot: 7, name: "Grouped", kind: "state", state: { seg: device.seg } });
    const before = await get<ImportPreview>(`/api/controllers/${c.id}/import`);
    expect(before.presets[0]!.status).toBe("conflict");

    await post(`/api/controllers/${c.id}/import`, { palettes: [], presets: [7] });
    const [p] = await get<Preset[]>("/api/presets");
    expect(p!.groups).toEqual([{ name: "Set 1", members: [1, 2], set: 1 }]);
    expect((await get<SyncPlan>(`/api/controllers/${c.id}/sync-plan`)).inSync).toBe(true);
    expect((await get<ImportPreview>(`/api/controllers/${c.id}/import`)).presets[0]!.status).toBe("identical");
    expect(mock.writes).toEqual([]);
  });

  it("reports conflicts with different library presets in the same slot and replaces them on import", async () => {
    const c = await setup();
    deviceFiles();
    await post("/api/presets", statePreset(2, "Mine", [{ fx: 0 }]));
    const preview = await get<ImportPreview>(`/api/controllers/${c.id}/import`);
    expect(preview.presets.find((p) => p.slot === 2)).toMatchObject({ status: "conflict", libraryName: "Mine" });

    await post(`/api/controllers/${c.id}/import`, { palettes: [], presets: [2] });
    expect((await get<Preset[]>("/api/presets")).map((p) => [p.slot, p.name, p.kind])).toEqual([[2, "Off", "raw"]]);
  });
});
