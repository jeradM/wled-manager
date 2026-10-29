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
import { effectRoutes } from "./routes/effects.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { locatorRoutes } from "./routes/locator.js";
import { paletteRoutes } from "./routes/palettes.js";
import { presetRoutes } from "./routes/presets.js";
import { settingsRoutes } from "./routes/settings.js";
import { syncRoutes } from "./routes/sync.js";
import { ControllerService, NotFoundError } from "./services/controllers.js";
import { LayeredEffectService } from "./services/effects.js";
import { LocatorService } from "./services/locator.js";
import { PaletteTools } from "./services/palette-tools.js";
import { PaletteService } from "./services/palettes.js";
import { PresetService, SlotTakenError } from "./services/presets.js";
import { SettingsService } from "./services/settings.js";
import { ImportService } from "./sync/import.js";
import { ControllerLocks, SyncConflictError } from "./sync/locks.js";
import { SyncService } from "./sync/sync.js";
import { WledError, type WledClientOptions } from "./wled/client.js";

export interface AppOptions {
  db: Db;
  webDist?: string;
  logger?: boolean;
  /** Default poll interval until one is saved in settings; 0 disables background polling. */
  pollIntervalMs?: number;
  wled?: WledClientOptions;
}

export async function buildApp({ db, webDist, logger = true, pollIntervalMs = 0, wled }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Treat an empty body sent as JSON as no body (Fastify's default parser rejects it with a 400).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      (e as Error & { statusCode?: number }).statusCode = 400;
      done(e as Error, undefined);
    }
  });

  const events = new EventBus();
  app.decorate("db", db);
  app.decorate("events", events);
  const controllers = new ControllerService(db, events, wled);
  controllers.upgradeSegmentDefinitions();
  const palettes = new PaletteService(db, events);
  const presets = new PresetService(db, events);
  const locks = new ControllerLocks();
  app.decorate("controllers", controllers);
  app.decorate("palettes", palettes);
  app.decorate("presets", presets);
  app.decorate("effects", new LayeredEffectService(db, events));
  app.decorate("paletteTools", new PaletteTools(controllers));
  app.decorate("sync", new SyncService(db, events, locks, controllers, palettes, presets));
  app.decorate("imports", new ImportService(db, events, locks, controllers, palettes, presets));
  const locator = new LocatorService(controllers, app.log);
  app.decorate("locator", locator);
  const settings = new SettingsService(db, events, { pollIntervalMs });
  app.decorate("settings", settings);
  // Hand controllers back in the state they were in if the server stops mid-session.
  app.addHook("onClose", async () => locator.stopAll());

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err))
      return reply.code(400).send({ error: "Invalid request", issues: err.validation });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof SyncConflictError || err instanceof SlotTakenError)
      return reply.code(409).send({ error: err.message });
    // The device, not this server, failed: report it as a bad gateway with the device error.
    if (err instanceof WledError) return reply.code(err.status === 409 ? 409 : 502).send({ error: err.message });
    // Client errors raised by Fastify itself (bad JSON, unsupported media type, ...) keep their status.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(controllerRoutes, { prefix: "/api" });
  await app.register(paletteRoutes, { prefix: "/api" });
  await app.register(presetRoutes, { prefix: "/api" });
  await app.register(effectRoutes, { prefix: "/api" });
  await app.register(syncRoutes, { prefix: "/api" });
  await app.register(locatorRoutes, { prefix: "/api" });
  await app.register(eventRoutes, { prefix: "/api" });
  await app.register(settingsRoutes, { prefix: "/api" });

  if (webDist && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: unknown non-API GETs serve index.html.
    app.setNotFoundHandler((req, reply) =>
      req.method === "GET" && !req.url.startsWith("/api")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ error: "Not found" }),
    );
  }

  // Polling starts once the server is ready and restarts whenever the interval is changed.
  let stopPoller: (() => void) | undefined;
  let ready = false;
  const applyPolling = (ms: number) => {
    stopPoller?.();
    stopPoller = ms > 0 ? startPoller(app.controllers, ms, app.log) : undefined;
  };
  app.addHook("onReady", async () => {
    ready = true;
    applyPolling(settings.get().pollIntervalMs);
  });
  settings.onChange((s) => ready && applyPolling(s.pollIntervalMs));
  app.addHook("onClose", async () => {
    ready = false;
    stopPoller?.();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    events: EventBus;
    controllers: ControllerService;
    palettes: PaletteService;
    presets: PresetService;
    effects: LayeredEffectService;
    paletteTools: PaletteTools;
    sync: SyncService;
    imports: ImportService;
    locator: LocatorService;
    settings: SettingsService;
  }
}
