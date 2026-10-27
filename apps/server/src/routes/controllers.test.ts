import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Controller, ServerEvent } from "@wled-manager/shared";
import { controllers } from "../db/schema.js";
import { createTestApp, startMock } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let mock: Awaited<ReturnType<typeof startMock>>;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMock({ name: "Porch", ledCount: 120, customPaletteMax: undefined });
});
afterEach(async () => {
  await t.cleanup();
  await mock.app.close();
});

const add = (body: object) => t.app.inject({ method: "POST", url: "/api/controllers", payload: body });

describe("controllers API", () => {
  it("adds a reachable controller and captures device details", async () => {
    const res = await add({ name: "Porch", host: mock.host, port: mock.port, tags: ["outdoor"] });
    expect(res.statusCode).toBe(201);
    const c = res.json<Controller>();
    expect(c).toMatchObject({ name: "Porch", status: "online", tags: ["outdoor"], hasPin: false });
    // No cpalmax reported -> upstream default of 10.
    expect(c.device).toMatchObject({ version: "0.15.0", ledCount: 120, rgbw: true, customPaletteMax: 10 });

    const catalog = await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/catalog` });
    expect(catalog.json().effects[0]).toBe("Solid");

    const list = await t.app.inject({ method: "GET", url: "/api/controllers" });
    expect(list.json()).toHaveLength(1);
  });

  it("only reads from the device when adding and refreshing", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/refresh` });
    await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/device-presets` });
    expect(mock.writes).toEqual([]);
  });

  it("rejects an unreachable controller with 502", async () => {
    const res = await add({ name: "Nope", host: "127.0.0.1", port: 1 });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/127\.0\.0\.1:1/);
  });

  it("validates input", async () => {
    expect((await add({ name: "", host: mock.host })).statusCode).toBe(400);
  });

  it("marks a controller offline when it stops answering, and emits events", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    const events: ServerEvent[] = [];
    t.app.events.subscribe((e) => events.push(e));

    await mock.app.close();
    const res = await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/refresh` });
    expect(res.json<Controller>()).toMatchObject({ status: "offline", device: { ledCount: 120 } });
    expect(res.json<Controller>().lastError).toBeTruthy();
    expect(events).toEqual([{ type: "controller.updated", controllerId: c.id }]);
  });

  it("does not emit events when a poll finds nothing new", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    const events: ServerEvent[] = [];
    t.app.events.subscribe((e) => events.push(e));
    await t.app.controllers.refresh(c.id);
    await t.app.controllers.refresh(c.id);
    expect(events).toEqual([]);
  });

  it("applies quick controls and lists device presets", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    mock.files.set("/presets.json", JSON.stringify({ "0": {}, "2": { n: "Warm" }, "1": { n: "Cool" } }));

    const presets = await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/device-presets` });
    expect(presets.json()).toEqual([
      { slot: 1, name: "Cool" },
      { slot: 2, name: "Warm" },
    ]);

    const res = await t.app.inject({
      method: "POST",
      url: `/api/controllers/${c.id}/state`,
      payload: { on: false, bri: 42 },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.getState()).toMatchObject({ on: false, bri: 42 });
  });

  it("leaves fields out of a partial update untouched", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port, tags: ["outdoor"] })).json<Controller>();
    const res = await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${c.id}`,
      payload: { markers: [{ index: 1, label: "x" }] },
    });
    expect(res.json<Controller>()).toMatchObject({ name: "Porch", port: mock.port, tags: ["outdoor"] });
  });

  it("stores ranges and segment definitions and reports the segment limit", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    expect(c.segments).toEqual([]);
    expect(c.device?.maxSegments).toBe(32);
    const segments = [
      { id: "s1", name: "Roof", start: "A", end: { type: "marker", label: "B", includeEnd: false } },
      { id: "s2", start: "B", end: { type: "length", count: -10 } },
      { id: "s3", range: "Posts", span: 1, reverse: true },
    ];
    const ranges = [{ label: "Posts", spans: [{ start: 2, stop: 5 }, { start: 8, stop: 9 }] }];
    const res = await t.app.inject({ method: "PATCH", url: `/api/controllers/${c.id}`, payload: { segments, ranges } });
    expect(res.json<Controller>()).toMatchObject({ segments, ranges });
    const patch = (payload: object) => t.app.inject({ method: "PATCH", url: `/api/controllers/${c.id}`, payload });
    expect((await patch({ ranges: [{ label: "x", spans: [{ start: 4, stop: 4 }] }] })).statusCode).toBe(400);
    expect((await patch({ segments: [{ id: "s", start: "A", end: { type: "length" } }] })).statusCode).toBe(400);
    expect((await patch({ segments: [{ start: "A", end: { type: "length", count: 3 } }] })).statusCode).toBe(400);
    expect((await patch({ segments: [segments[0], { ...segments[1], id: "s1" }] })).statusCode).toBe(400);
  });

  it("upgrades segment plans saved before definitions had IDs", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    t.app.db
      .update(controllers)
      .set({ segments: [{ range: "Posts", span: 0, reverse: false, grp: 2, spc: 1 }] as never })
      .where(eq(controllers.id, c.id))
      .run();
    t.app.controllers.upgradeSegmentDefinitions();
    const [def] = t.app.controllers.get(c.id).segments;
    expect(def).toEqual({ id: expect.any(String), range: "Posts", span: 0, reverse: false });
  });

  it("updates and deletes", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    const patched = await t.app.inject({ method: "PATCH", url: `/api/controllers/${c.id}`, payload: { name: "Front" } });
    expect(patched.json().name).toBe("Front");
    expect((await t.app.inject({ method: "DELETE", url: `/api/controllers/${c.id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}` })).statusCode).toBe(404);
  });

  describe("export and import", () => {
    const setup = {
      layout: { type: "grid", columns: 20, serpentine: true, reverse: false },
      markers: [{ index: 10, label: "Corner" }],
      ranges: [{ label: "Posts", spans: [{ start: 0, stop: 5 }] }],
      segments: [
        { id: "roof", name: "Roof", start: "Corner", end: { type: "length", count: 30 } },
        { id: "posts", range: "Posts", span: 0, reverse: false },
      ],
    };

    const exported = async () => {
      const c = (await add({ name: "Front Porch", host: mock.host, port: mock.port, tags: ["outdoor"], pin: "1234" })).json<Controller>();
      await t.app.inject({ method: "PATCH", url: `/api/controllers/${c.id}`, payload: setup });
      const res = await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/export` });
      expect(res.headers["content-disposition"]).toBe(`attachment; filename="front-porch.wled-controller.json"`);
      return res.json();
    };

    it("exports a controller's setup without its PIN", async () => {
      const file = await exported();
      expect(file).toMatchObject({
        format: "wled-manager/controller",
        version: 1,
        controller: { name: "Front Porch", host: mock.host, port: mock.port, tags: ["outdoor"], ledCount: 120, ...setup },
      });
      expect(JSON.stringify(file)).not.toContain("1234");
    });

    it("adds the controller to another instance, keeping segment IDs", async () => {
      const file = await exported();
      const other = await createTestApp();
      try {
        const res = await other.app.inject({ method: "POST", url: "/api/controllers/import", payload: { file } });
        expect(res.statusCode).toBe(201);
        expect(res.json<Controller>()).toMatchObject({ name: "Front Porch", tags: ["outdoor"], hasPin: false, status: "online", ...setup });

        // Name, address and PIN can be changed from the file's.
        const renamed = await other.app.inject({
          method: "POST",
          url: "/api/controllers/import",
          payload: { file, name: "Back Porch", pin: "42" },
        });
        expect(renamed.json<Controller>()).toMatchObject({ name: "Back Porch", hasPin: true, segments: setup.segments });

        const unreachable = await other.app.inject({ method: "POST", url: "/api/controllers/import", payload: { file, port: 1 } });
        expect(unreachable.statusCode).toBe(502);
      } finally {
        await other.cleanup();
      }
      expect(mock.writes).toEqual([]);
    });

    it("replaces an existing controller's setup, leaving its name and address", async () => {
      const file = await exported();
      const c = (await add({ name: "Garage", host: mock.host, port: mock.port, tags: ["indoor"] })).json<Controller>();
      const res = await t.app.inject({ method: "PUT", url: `/api/controllers/${c.id}/setup`, payload: file });
      expect(res.json<Controller>()).toMatchObject({ name: "Garage", tags: ["indoor"], ...setup });
    });

    it("rejects files that aren't controller exports", async () => {
      const file = await exported();
      const post = (payload: object) => t.app.inject({ method: "POST", url: "/api/controllers/import", payload });
      expect((await post({ file: { ...file, format: "other" } })).statusCode).toBe(400);
      expect((await post({ file: { ...file, version: 2 } })).statusCode).toBe(400);
      const dup = { ...file.controller, segments: [setup.segments[0], setup.segments[0]] };
      expect((await post({ file: { ...file, controller: dup } })).statusCode).toBe(400);
    });
  });
});
