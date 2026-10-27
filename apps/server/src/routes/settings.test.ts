import { afterEach, describe, expect, it } from "vitest";
import type { Controller, Preset } from "@wled-manager/shared";
import { createTestApp, startMock } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>> | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

describe("settings", () => {
  it("defaults to the startup poll interval, then saves and validates changes", async () => {
    t = await createTestApp({ pollIntervalMs: 30_000 });
    expect((await t.app.inject({ method: "GET", url: "/api/settings" })).json()).toEqual({ pollIntervalMs: 30_000 });
    const saved = await t.app.inject({ method: "PUT", url: "/api/settings", payload: { pollIntervalMs: 60_000 } });
    expect(saved.json()).toEqual({ pollIntervalMs: 60_000 });
    expect((await t.app.inject({ method: "GET", url: "/api/settings" })).json()).toEqual({ pollIntervalMs: 60_000 });
    for (const pollIntervalMs of [1_000, -1, 4_000_000])
      expect((await t.app.inject({ method: "PUT", url: "/api/settings", payload: { pollIntervalMs } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: "/api/settings", payload: { pollIntervalMs: 0 } })).json()).toEqual({
      pollIntervalMs: 0,
    });
  });

  it("starts polling when an interval is set from the UI", async () => {
    t = await createTestApp({ pollIntervalMs: 0 });
    const mock = await startMock();
    const c = (
      await t.app.inject({ method: "POST", url: "/api/controllers", payload: { name: "M", host: mock.host, port: mock.port } })
    ).json<Controller>();
    await mock.stop();
    // Nothing polls yet, so the controller still looks online.
    await new Promise((r) => setTimeout(r, 100));
    expect(t.app.controllers.get(c.id).status).toBe("online");
    await t.app.inject({ method: "PUT", url: "/api/settings", payload: { pollIntervalMs: 5_000 } });
    // The poller polls right away when it starts.
    await expect.poll(() => t!.app.controllers.get(c.id).status, { timeout: 3000 }).toBe("offline");
  });
});

describe("preset segment groups", () => {
  it("are stored with state presets but never sent to controllers", async () => {
    t = await createTestApp();
    const mock = await startMock();
    const c = (
      await t.app.inject({ method: "POST", url: "/api/controllers", payload: { name: "M", host: mock.host, port: mock.port } })
    ).json<Controller>();
    const groups = [{ name: "Windows", members: [0, 2] }];
    const preset = (
      await t.app.inject({
        method: "POST",
        url: "/api/presets",
        payload: { slot: 1, name: "P", kind: "state", state: { seg: [{ fx: 1 }, { fx: 2 }, { fx: 1 }] }, groups },
      })
    ).json<Preset>();
    expect(preset.groups).toEqual(groups);
    expect((await t.app.inject({ method: "GET", url: `/api/presets/${preset.id}` })).json<Preset>().groups).toEqual(groups);

    await t.app.inject({ method: "POST", url: `/api/controllers/${c.id}/sync` });
    const file = mock.files.get("/presets.json")!;
    expect(JSON.parse(file)["1"]).toMatchObject({ n: "P", seg: [{ fx: 1 }, { fx: 2 }, { fx: 1 }] });
    expect(file).not.toContain("Windows");
    await mock.stop();
  });
});
