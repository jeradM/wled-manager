import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Controller } from "@wled-manager/shared";
import { createTestApp, startMock } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let mock: Awaited<ReturnType<typeof startMock>>;
let c: Controller;

beforeEach(async () => {
  t = await createTestApp();
  mock = await startMock({ ledCount: 20 });
  c = (await t.app.inject({ method: "POST", url: "/api/controllers", payload: { name: "M", host: mock.host, port: mock.port } })).json();
});
afterEach(async () => {
  await t.cleanup();
  await mock.stop();
});

const post = (path: string, payload?: object) =>
  t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/locate${path}`, ...(payload ? { payload } : {}) });

describe("LED locator", () => {
  it("lights one LED at a time across the whole strip, then restores the previous state", async () => {
    // A user setup: two segments with grouping, partial range, an effect running.
    await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/state`, payload: { bri: 40 } });
    // Real /json/state reports every segment field, which is what makes a full restore possible.
    const full = { grp: 1, spc: 0, of: 0, rev: false, mi: false, bri: 255, frz: false, on: true };
    mock.getState().seg = [
      { ...full, id: 0, start: 2, stop: 12, grp: 2, spc: 1, fx: 9, len: 10 },
      { ...full, id: 1, start: 12, stop: 20, fx: 3, len: 8 },
    ];
    const before = structuredClone(mock.getState());

    expect((await post("/start")).json()).toEqual({ ledCount: 20 });
    const seg = mock.getState().seg as Record<string, unknown>[];
    expect(seg[0]).toMatchObject({ start: 0, stop: 20, grp: 1, spc: 0, on: true });
    expect(seg[1]).toMatchObject({ on: false });

    await post("", { index: 5, color: "#ff0000" });
    expect(mock.pixels()[5]).toBe("ff0000");
    expect(mock.pixels().filter((p) => p !== "000000")).toHaveLength(1);

    await post("", { index: 6, color: "00ff00" });
    expect(mock.pixels()[5]).toBe("000000");
    expect(mock.pixels()[6]).toBe("00ff00");

    expect((await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/locate` })).json()).toEqual({ active: true });
    await post("/stop");
    expect(mock.isFrozen()).toBe(false);
    const after = mock.getState();
    expect(after.bri).toBe(40);
    // Everything but the read-only "len" is put back as it was.
    const withoutLen = (segs: unknown) => (segs as Record<string, unknown>[]).map(({ len, ...rest }) => rest);
    expect(withoutLen(after.seg)).toEqual(withoutLen(before.seg));
    expect((await t.app.inject({ method: "GET", url: `/api/controllers/${c.id}/locate` })).json()).toEqual({ active: false });
  });

  it("rejects LEDs out of range and requests without a session", async () => {
    expect((await post("", { index: 1, color: "ffffff" })).statusCode).toBe(409);
    await post("/start");
    expect((await post("", { index: 20, color: "ffffff" })).statusCode).toBe(409);
  });

  it("restores controllers when the server shuts down mid-session", async () => {
    await post("/start");
    await post("", { index: 3, color: "ffffff" });
    await t.app.close();
    expect(mock.isFrozen()).toBe(false);
    expect((mock.getState().seg as Record<string, unknown>[])[0]).toMatchObject({ start: 0, stop: 20 });
  });

  it("saves layout and markers on the controller", async () => {
    const res = await t.app.inject({
      method: "PATCH",
      url: `/api/controllers/${c.id}`,
      payload: { layout: { type: "ring", columns: 10, serpentine: false, reverse: true }, markers: [{ index: 9, label: "B" }, { index: 2, label: "A" }] },
    });
    expect(res.json<Controller>()).toMatchObject({
      layout: { type: "ring", reverse: true },
      markers: [{ index: 2, label: "A" }, { index: 9, label: "B" }],
    });
    expect(mock.writes.filter((w) => !w.startsWith("POST /json/state"))).toEqual([]);
  });
});
