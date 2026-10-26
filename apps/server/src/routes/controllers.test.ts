import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Controller, ServerEvent } from "@wled-manager/shared";
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

  it("updates and deletes", async () => {
    const c = (await add({ name: "Porch", host: mock.host, port: mock.port })).json<Controller>();
    const patched = await t.app.inject({ method: "PATCH", url: `/api/controllers/${c.id}`, payload: { name: "Front" } });
    expect(patched.json().name).toBe("Front");
    expect((await t.app.inject({ method: "DELETE", url: `/api/controllers/${c.id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}` })).statusCode).toBe(404);
  });
});
