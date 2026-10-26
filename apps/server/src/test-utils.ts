import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMockWled, type MockOptions } from "mock-wled";
import { buildApp, type AppOptions } from "./app.js";
import { openDb } from "./db/index.js";

const migrationsDir = path.resolve(import.meta.dirname, "../drizzle");

/** App backed by a fresh SQLite DB in a temp dir. Call cleanup() when done. */
export async function createTestApp(opts: Partial<AppOptions> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wled-manager-test-"));
  const db = openDb(dataDir, migrationsDir);
  const app = await buildApp({ db, logger: false, wled: { timeoutMs: 500, retries: 0 }, ...opts });
  return {
    app,
    db,
    cleanup: async () => {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Starts a mock WLED device on a random local port. */
export async function startMock(opts?: MockOptions) {
  const mock = createMockWled(opts);
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  const address = mock.app.server.address();
  if (!address || typeof address === "string") throw new Error("mock has no port");
  return { ...mock, host: "127.0.0.1", port: address.port, stop: () => mock.app.close() };
}
