import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db/index.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wled-manager-test-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("app", () => {
  it("runs migrations and answers health checks", async () => {
    const db = openDb(dataDir, path.resolve(import.meta.dirname, "../drizzle"));
    const app = await buildApp({ db, logger: false });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
