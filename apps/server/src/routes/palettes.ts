import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { palette, paletteInput, paletteStop } from "@wled-manager/shared";

const params = z.object({ id: z.string() });

export const paletteRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = app.palettes;

  app.get("/palettes", { schema: { response: { 200: z.array(palette) } } }, async () => svc.list());

  app.post("/palettes", { schema: { body: paletteInput, response: { 201: palette } } }, async (req, reply) =>
    reply.code(201).send(svc.create(req.body)),
  );

  app.get("/palettes/:id", { schema: { params, response: { 200: palette } } }, async (req) => svc.get(req.params.id));

  app.put("/palettes/:id", { schema: { params, body: paletteInput, response: { 200: palette } } }, async (req) =>
    svc.update(req.params.id, req.body),
  );

  app.delete("/palettes/:id", { schema: { params } }, async (req, reply) => {
    svc.remove(req.params.id);
    return reply.code(204).send();
  });

  app.get(
    "/controllers/:id/builtin-palettes",
    {
      schema: {
        params,
        response: {
          200: z.array(z.object({ id: z.number(), name: z.string(), stops: z.array(paletteStop).nullable() })),
        },
      },
    },
    async (req) => app.paletteTools.builtinPalettes(req.params.id),
  );

  app.post(
    "/controllers/:id/palette-preview",
    {
      schema: {
        params,
        body: z.object({ stops: paletteInput.shape.stops }),
        response: { 200: z.object({ slot: z.number(), deviceId: z.number() }) },
      },
    },
    async (req) => app.paletteTools.preview(req.params.id, req.body.stops),
  );
};
