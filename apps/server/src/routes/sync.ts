import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const params = z.object({ id: z.string() });
const slots = z.array(z.number().int().min(0).max(250));

export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  /** What a sync would change on the device. Read-only. */
  app.get("/controllers/:id/sync-plan", { schema: { params } }, async (req) => app.sync.plan(req.params.id));

  app.post("/controllers/:id/sync", { schema: { params } }, async (req) => app.sync.apply(req.params.id));

  /** What the controller has that could be imported into the library. Read-only. */
  app.get("/controllers/:id/import", { schema: { params } }, async (req) => app.imports.preview(req.params.id));

  /** Imports the chosen palette slots and preset slots. Only reads from the device. */
  app.post(
    "/controllers/:id/import",
    { schema: { params, body: z.object({ palettes: slots, presets: slots }) } },
    async (req) => {
      const result = await app.imports.apply(req.params.id, req.body);
      app.events.publish({ type: "sync.completed", controllerId: req.params.id });
      return result;
    },
  );
};
