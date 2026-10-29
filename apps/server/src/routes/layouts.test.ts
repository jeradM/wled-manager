import { afterEach, describe, expect, it } from "vitest";
import type { Layout } from "@wled-manager/shared";
import { createTestApp } from "../test-utils.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
afterEach(async () => t.cleanup());

// A 1×1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const lines = [{ id: "a", controllerId: null, from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.2 }, count: 10 }];

describe("layouts", () => {
  it("creates, updates, lists and deletes layouts", async () => {
    t = await createTestApp();
    const created = await t.app.inject({ method: "POST", url: "/api/layouts", payload: { name: "House", lines, ledSize: 8 } });
    expect(created.statusCode).toBe(201);
    const l = created.json<Layout>();
    expect(l).toMatchObject({ name: "House", lines, ledSize: 8, image: null, revision: 1 });

    const gap = { ...lines[0]!, id: "b", count: 0, firstLed: 20 };
    const updated = await t.app.inject({ method: "PUT", url: `/api/layouts/${l.id}`, payload: { name: "House", lines: [...lines, gap], ledSize: 6 } });
    expect(updated.json<Layout>()).toMatchObject({ lines: [lines[0], gap], ledSize: 6, revision: 2 });
    expect((await t.app.inject({ method: "GET", url: "/api/layouts" })).json<Layout[]>()).toHaveLength(1);

    expect((await t.app.inject({ method: "DELETE", url: `/api/layouts/${l.id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/layouts/${l.id}` })).statusCode).toBe(404);
  });

  it("stores and serves the picture", async () => {
    t = await createTestApp();
    const l = (await t.app.inject({ method: "POST", url: "/api/layouts", payload: { name: "Tree", lines: [], ledSize: 8 } })).json<Layout>();
    expect((await t.app.inject({ method: "GET", url: `/api/layouts/${l.id}/image` })).statusCode).toBe(404);

    const put = await t.app.inject({
      method: "PUT",
      url: `/api/layouts/${l.id}/image?width=1&height=1`,
      headers: { "content-type": "image/png" },
      payload: png,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<Layout>().image).toEqual({ type: "image/png", width: 1, height: 1 });

    const got = await t.app.inject({ method: "GET", url: `/api/layouts/${l.id}/image` });
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.rawPayload.equals(png)).toBe(true);
    const again = await t.app.inject({ method: "GET", url: `/api/layouts/${l.id}/image`, headers: { "if-none-match": got.headers.etag as string } });
    expect(again.statusCode).toBe(304);

    // The list doesn't carry the picture itself.
    expect(JSON.stringify((await t.app.inject({ method: "GET", url: "/api/layouts" })).json())).not.toContain("iVBOR");

    const cleared = await t.app.inject({ method: "DELETE", url: `/api/layouts/${l.id}/image` });
    expect(cleared.json<Layout>().image).toBeNull();
  });

  it("rejects other file types and oversized pictures", async () => {
    t = await createTestApp();
    const l = (await t.app.inject({ method: "POST", url: "/api/layouts", payload: { name: "X", lines: [], ledSize: 8 } })).json<Layout>();
    const url = `/api/layouts/${l.id}/image?width=1&height=1`;
    expect((await t.app.inject({ method: "PUT", url, headers: { "content-type": "application/pdf" }, payload: png })).statusCode).toBe(415);
    const big = Buffer.alloc(16 * 1024 * 1024);
    expect((await t.app.inject({ method: "PUT", url, headers: { "content-type": "image/png" }, payload: big })).statusCode).toBe(413);
  });
});
