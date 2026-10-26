import { buildApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";

const db = openDb(config.dataDir, config.migrationsDir);
const app = await buildApp({ db, webDist: config.webDist, pollIntervalMs: config.pollIntervalMs });
await app.listen({ port: config.port, host: config.host });
