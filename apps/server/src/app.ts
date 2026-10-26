import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "./db/index.js";
import { EventBus } from "./events.js";
import { startPoller } from "./poller.js";
import { controllerRoutes } from "./routes/controllers.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { paletteRoutes } from "./routes/palettes.js";
import { syncRoutes } from "./routes/sync.js";
import { ControllerService, NotFoundError } from "./services/controllers.js";
import { PaletteTools } from "./services/palette-tools.js";
import { PaletteService } from "./services/palettes.js";
import { SyncConflictError, SyncService } from "./sync/sync.js";
import { WledError, type WledClientOptions } from "./wled/client.js";

export interface AppOptions {
  db: Db;
  webDist?: string;
  logger?: boolean;
  /** 0 disables background polling. */
  pollIntervalMs?: number;
  wled?: WledClientOptions;
}

export async function buildApp({ db, webDist, logger = true, pollIntervalMs = 0, wled }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const events = new EventBus();
  app.decorate("db", db);
  app.decorate("events", events);
  const controllers = new ControllerService(db, events, wled);
  const palettes = new PaletteService(db, events);
  app.decorate("controllers", controllers);
  app.decorate("palettes", palettes);
  app.decorate("paletteTools", new PaletteTools(controllers));
  app.decorate("sync", new SyncService(db, events, controllers, palettes));

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err))
      return reply.code(400).send({ error: "Invalid request", issues: err.validation });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof SyncConflictError) return reply.code(409).send({ error: err.message });
    // The device, not this server, failed: report it as a bad gateway with the device error.
    if (err instanceof WledError) return reply.code(err.status === 409 ? 409 : 502).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(controllerRoutes, { prefix: "/api" });
  await app.register(paletteRoutes, { prefix: "/api" });
  await app.register(syncRoutes, { prefix: "/api" });
  await app.register(eventRoutes, { prefix: "/api" });

  if (webDist && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: unknown non-API GETs serve index.html.
    app.setNotFoundHandler((req, reply) =>
      req.method === "GET" && !req.url.startsWith("/api")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ error: "Not found" }),
    );
  }

  if (pollIntervalMs > 0) {
    let stopPoller: (() => void) | undefined;
    app.addHook("onReady", async () => {
      stopPoller = startPoller(app.controllers, pollIntervalMs, app.log);
    });
    app.addHook("onClose", async () => stopPoller?.());
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    events: EventBus;
    controllers: ControllerService;
    palettes: PaletteService;
    paletteTools: PaletteTools;
    sync: SyncService;
  }
}
