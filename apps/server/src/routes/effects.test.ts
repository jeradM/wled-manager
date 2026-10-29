import { afterEach, describe, expect, it } from "vitest";
import type { LayeredEffect } from "@wled-manager/shared";
import { createTestApp } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
afterEach(async () => t.cleanup());

describe("layered effects", () => {
  it("creates, lists, updates and deletes layered effects", async () => {
    t = await createTestApp();
    const layers = [{ fx: 0, fxName: "Solid", col: [[255, 0, 0]] }, { fx: 2, fxName: "Breathe", bm: 6, bri: 128 }];
    const created = await t.app.inject({ method: "POST", url: "/api/effects", payload: { name: "Glow", layers } });
    expect(created.statusCode).toBe(201);
    const e = created.json<LayeredEffect>();
    expect(e).toMatchObject({ name: "Glow", layers, revision: 1 });

    const updated = await t.app.inject({ method: "PUT", url: `/api/effects/${e.id}`, payload: { name: "Glow 2", layers: [layers[1]] } });
    expect(updated.json<LayeredEffect>()).toMatchObject({ name: "Glow 2", layers: [layers[1]], revision: 2 });
    expect((await t.app.inject({ method: "GET", url: "/api/effects" })).json<LayeredEffect[]>().map((x) => x.name)).toEqual(["Glow 2"]);

    expect((await t.app.inject({ method: "DELETE", url: `/api/effects/${e.id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/effects/${e.id}` })).statusCode).toBe(404);
  });

  it("needs a name and at least one layer", async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: "POST", url: "/api/effects", payload: { name: "x", layers: [] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/api/effects", payload: { name: " ", layers: [{ fx: 0 }] } })).statusCode).toBe(400);
  });
});
