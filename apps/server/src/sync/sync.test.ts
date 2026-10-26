import { afterEach, describe, expect, it } from "vitest";
import type { Controller, Palette, SyncPlan } from "@wled-manager/shared";
import { createTestApp, startMock } from "../test-utils.js";
import type { MockOptions } from "mock-wled";

let t: Awaited<ReturnType<typeof createTestApp>>;
let mock: Awaited<ReturnType<typeof startMock>>;

afterEach(async () => {
  await t.cleanup();
  await mock.stop();
});

async function setup(opts: MockOptions = {}) {
  t = await createTestApp();
  mock = await startMock(opts);
  const res = await t.app.inject({
    method: "POST",
    url: "/api/controllers",
    payload: { name: "Mock", host: mock.host, port: mock.port },
  });
  return res.json<Controller>();
}

const red = [{ pos: 0, color: "#ff0000" }, { pos: 255, color: "#000000" }];
const green = [{ pos: 0, color: "#00ff00" }, { pos: 255, color: "#000000" }];
const blue = [{ pos: 0, color: "#0000ff" }, { pos: 255, color: "#000000" }];

async function addPalette(name: string, stops: typeof red) {
  const res = await t.app.inject({ method: "POST", url: "/api/palettes", payload: { name, stops } });
  expect(res.statusCode).toBe(201);
  return res.json<Palette>();
}

const plan = async (id: string) => (await t.app.inject({ method: "GET", url: `/api/controllers/${id}/sync-plan` })).json<SyncPlan>();
const sync = (id: string) => t.app.inject({ method: "POST", url: `/api/controllers/${id}/sync` });
const actions = (p: SyncPlan) => p.palettes.map((c) => `${c.action}:${c.slot}${c.name ? `:${c.name}` : ""}`);

describe("palette sync", () => {
  it("plans without writing, then creates palette files on first sync", async () => {
    const c = await setup();
    await addPalette("Red", red);
    await addPalette("Green", green);

    const p = await plan(c.id);
    expect(actions(p)).toEqual(["create:0:Red", "create:1:Green"]);
    expect(p.palettes.map((x) => x.deviceId)).toEqual([255, 254]);
    expect(p.inSync).toBe(false);
    expect(mock.writes).toEqual([]);

    expect((await sync(c.id)).statusCode).toBe(200);
    expect(JSON.parse(mock.files.get("/palette0.json")!)).toEqual({ palette: [0, 255, 0, 0, 255, 0, 0, 0] });
    expect(mock.loadedPalettes()).toBe(2);
    expect((await plan(c.id)).inSync).toBe(true);
  });

  it("treats hex-form device files with the same colors as unchanged", async () => {
    const c = await setup();
    await addPalette("Red", red);
    mock.files.set("/palette0.json", JSON.stringify({ palette: [0, "FF0000", 255, "000000"] }));
    expect(actions(await plan(c.id))).toEqual(["unchanged:0:Red"]);
  });

  it("overwrites and removes palettes the library doesn't account for (older firmware)", async () => {
    const c = await setup();
    for (let i = 0; i < 3; i++) mock.files.set(`/palette${i}.json`, JSON.stringify({ palette: [0, "123456", 255, "654321"] }));
    await addPalette("Red", red);

    const p = await plan(c.id);
    expect(actions(p)).toEqual(["update:0:Red", "delete:1", "delete:2"]);
    expect(p.palettes.every((x) => x.replacesUnmanaged)).toBe(true);
    await sync(c.id);
    expect([...mock.files.keys()].filter((f) => f.startsWith("/palette"))).toEqual(["/palette0.json"]);
    // Deleting files doesn't reload palettes on older firmware; the sync re-uploads one to force it.
    expect(mock.loadedPalettes()).toBe(1);
    expect(mock.writes.filter((w) => w.startsWith("DELETE"))).toEqual(["DELETE /palette2.json", "DELETE /palette1.json"]);
  });

  it("uses rmcpal and 200-based IDs on modern firmware", async () => {
    const c = await setup({ modernPalettes: true });
    mock.files.set("/palette1.json", JSON.stringify({ palette: [0, "123456", 255, "654321"] }));
    await addPalette("Red", red);

    const p = await plan(c.id);
    expect(p.palettes.map((x) => [x.action, x.deviceId])).toEqual([["create", 200], ["delete", 199]]);
    await sync(c.id);
    expect(mock.files.has("/palette1.json")).toBe(false);
    expect(mock.writes.some((w) => w.startsWith("DELETE"))).toBe(false);
    expect(mock.loadedPalettes()).toBe(1);
  });

  it("keeps slots stable and fills a hole by moving the last palette", async () => {
    const c = await setup();
    const r = await addPalette("Red", red);
    await addPalette("Green", green);
    await addPalette("Blue", blue);
    await sync(c.id);

    await t.app.inject({ method: "DELETE", url: `/api/palettes/${r.id}` });
    const p = await plan(c.id);
    expect(actions(p)).toEqual(["update:0:Blue", "unchanged:1:Green", "delete:2"]);
    // These files were written by the manager, so they aren't flagged as someone else's.
    expect(p.palettes.some((x) => x.replacesUnmanaged)).toBe(false);
    await sync(c.id);
    expect((await plan(c.id)).inSync).toBe(true);

    // A palette edited on the device (e.g. in the WLED UI) is flagged before the manager overwrites it.
    mock.files.set("/palette1.json", JSON.stringify({ palette: [0, "abcdef", 255, "000000"] }));
    const edited = await plan(c.id);
    expect(edited.palettes.find((x) => x.slot === 1)).toMatchObject({ action: "update", replacesUnmanaged: true });
    await sync(c.id);

    // Editing a palette changes only its own file.
    const palettes = (await t.app.inject({ method: "GET", url: "/api/palettes" })).json<Palette[]>();
    const green2 = palettes.find((p) => p.name === "Green")!;
    const updated = await t.app.inject({ method: "PUT", url: `/api/palettes/${green2.id}`, payload: { name: "Green", stops: red } });
    expect(updated.json<Palette>().revision).toBe(2);
    expect(actions(await plan(c.id))).toEqual(["unchanged:0:Blue", "update:1:Green"]);
  });

  it("warns when the library exceeds the controller's capacity", async () => {
    const c = await setup({ customPaletteMax: 2 });
    await addPalette("Red", red);
    await addPalette("Green", green);
    await addPalette("Blue", blue);
    const p = await plan(c.id);
    expect(actions(p)).toEqual(["create:0:Red", "create:1:Green"]);
    expect(p.warnings[0]).toMatch(/at most 2.*Blue/);
  });

  it("rejects invalid palettes", async () => {
    t = await createTestApp();
    mock = await startMock();
    const res = await t.app.inject({ method: "POST", url: "/api/palettes", payload: { name: "x", stops: [red[0]] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("palette tools", () => {
  it("previews unsaved stops in a spare slot past existing files", async () => {
    const c = await setup();
    mock.files.set("/palette0.json", JSON.stringify({ palette: [0, "123456", 255, "654321"] }));
    const res = await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/palette-preview`, payload: { stops: red } });
    expect(res.json()).toEqual({ slot: 1, deviceId: 254 });
    expect(mock.files.get("/palette0.json")).toContain("123456");
    expect(mock.files.has("/palette1.json")).toBe(true);
    expect(mock.getState().seg).toEqual({ pal: 254 });
  });

  it("lists built-in palettes, marking color-derived ones as not copyable", async () => {
    const c = await setup();
    const res = await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/builtin-palettes` });
    const list = res.json<{ id: number; name: string; stops: unknown[] | null }[]>();
    expect(list[0]).toMatchObject({ id: 0, name: "Default", stops: null });
    expect(list[6]).toMatchObject({ name: "Party", stops: [{ pos: 0, color: "#3c0000" }, { pos: 255, color: "#00003c" }] });
  });
});
