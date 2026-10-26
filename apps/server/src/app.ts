import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "./db/index.js";
import { healthRoutes } from "./routes/health.js";

export interface AppOptions {
  db: Db;
  webDist?: string;
  logger?: boolean;
}

export async function buildApp({ db, webDist, logger = true }: AppOptions) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db);

  await app.register(healthRoutes, { prefix: "/api" });

  if (webDist && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: unknown non-API GETs serve index.html.
    app.setNotFoundHandler((req, reply) =>
      req.method === "GET" && !req.url.startsWith("/api")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ error: "Not found" }),
    );
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
