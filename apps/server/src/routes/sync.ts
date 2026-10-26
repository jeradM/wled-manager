import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const params = z.object({ id: z.string() });

export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  /** What a sync would change on the device. Read-only. */
  app.get("/controllers/:id/sync-plan", { schema: { params } }, async (req) => app.sync.plan(req.params.id));

  app.post("/controllers/:id/sync", { schema: { params } }, async (req) => app.sync.apply(req.params.id));
};
