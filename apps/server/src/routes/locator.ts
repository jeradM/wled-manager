import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ledSpan } from "@wled-manager/shared";

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
        // One LED (index) or several runs of LEDs (spans).
        body: z
          .object({
            index: z.number().int().min(0).optional(),
            spans: z.array(ledSpan).max(256).optional(),
            color: z.string().regex(/^#?[0-9a-f]{6}$/i),
          })
          .refine((b) => (b.index === undefined) !== (b.spans === undefined), { message: "give index or spans" }),
      },
    },
    async (req) => {
      const { index, spans, color } = req.body;
      await app.locator.show(req.params.id, spans ?? [{ start: index!, stop: index! + 1 }], color);
      return { ok: true };
    },
  );

  app.post("/controllers/:id/locate/stop", { schema: { params } }, async (req) => {
    await app.locator.stop(req.params.id);
    return { ok: true };
  });
};
