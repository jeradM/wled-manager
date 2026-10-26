import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test-utils.js";

let cleanup: () => Promise<void>;
afterEach(() => cleanup?.());

describe("app", () => {
  it("runs migrations and answers health checks", async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    const res = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("accepts bodiless POSTs labelled as JSON and rejects malformed JSON", async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    const json = { "content-type": "application/json" };
    // No such controller: getting a 404 (not a 400) shows the empty body was accepted.
    const empty = await t.app.inject({ method: "POST", url: "/api/controllers/nope/refresh", headers: json });
    expect(empty.statusCode).toBe(404);
    const bad = await t.app.inject({ method: "POST", url: "/api/palettes", headers: json, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
  });
});
