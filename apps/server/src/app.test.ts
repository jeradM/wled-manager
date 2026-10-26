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
});
