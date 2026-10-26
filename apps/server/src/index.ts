import { buildApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";

const db = openDb(config.dataDir, config.migrationsDir);
const app = await buildApp({ db, webDist: config.webDist, pollIntervalMs: config.pollIntervalMs });
await app.listen({ port: config.port, host: config.host });

// Close cleanly (restoring any controllers mid-locate) on Ctrl-C and container stop.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
