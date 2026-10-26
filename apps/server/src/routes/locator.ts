import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const params = z.object({ id: z.string() });

export const locatorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/controllers/:id/locate", { schema: { params } }, async (req) => ({
    active: app.locator.isActive(req.params.id),
  }));

  app.post("/controllers/:id/locate/start", { schema: { params } }, async (req) => app.locator.start(req.params.id));

  app.post(
    "/controllers/:id/locate",
    {
      schema: {
        params,
        body: z.object({ index: z.number().int().min(0), color: z.string().regex(/^#?[0-9a-f]{6}$/i) }),
      },
    },
    async (req) => {
      await app.locator.show(req.params.id, req.body.index, req.body.color);
      return { ok: true };
    },
  );

  app.post("/controllers/:id/locate/stop", { schema: { params } }, async (req) => {
    await app.locator.stop(req.params.id);
    return { ok: true };
  });
};
