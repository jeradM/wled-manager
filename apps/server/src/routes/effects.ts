import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { layeredEffect, layeredEffectInput } from "@wled-manager/shared";

const params = z.object({ id: z.string() });

export const effectRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = app.effects;

  app.get("/effects", { schema: { response: { 200: z.array(layeredEffect) } } }, async () => svc.list());

  app.post("/effects", { schema: { body: layeredEffectInput, response: { 201: layeredEffect } } }, async (req, reply) =>
    reply.code(201).send(svc.create(req.body)),
  );

  app.get("/effects/:id", { schema: { params, response: { 200: layeredEffect } } }, async (req) => svc.get(req.params.id));

  app.put("/effects/:id", { schema: { params, body: layeredEffectInput, response: { 200: layeredEffect } } }, async (req) =>
    svc.update(req.params.id, req.body),
  );

  app.delete("/effects/:id", { schema: { params } }, async (req, reply) => {
    svc.remove(req.params.id);
    return reply.code(204).send();
  });
};
