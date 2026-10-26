import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { preset, presetInput } from "@wled-manager/shared";
import { customPaletteBase } from "../wled/client.js";

const params = z.object({ id: z.string() });

export const presetRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = app.presets;

  app.get("/presets", { schema: { response: { 200: z.array(preset) } } }, async () => svc.list());

  app.post("/presets", { schema: { body: presetInput, response: { 201: preset } } }, async (req, reply) =>
    reply.code(201).send(svc.create(req.body)),
  );

  app.get("/presets/:id", { schema: { params, response: { 200: preset } } }, async (req) => svc.get(req.params.id));

  app.put("/presets/:id", { schema: { params, body: presetInput, response: { 200: preset } } }, async (req) =>
    svc.update(req.params.id, req.body),
  );

  app.delete("/presets/:id", { schema: { params } }, async (req, reply) => {
    svc.remove(req.params.id);
    return reply.code(204).send();
  });

  /** Applies an (unsaved) preset to a controller's live state without storing it there. */
  app.post(
    "/controllers/:id/preset-test",
    { schema: { params, body: presetInput, response: { 200: z.object({ warnings: z.array(z.string()) }) } } },
    async (req) => {
      const client = app.controllers.client(app.controllers.getRow(req.params.id));
      const info = await client.getInfo();
      const { json, warnings } = app.sync.renderForDevice(req.params.id, req.body, customPaletteBase(info));
      const { n, ql, ...state } = json;
      await client.setState(state);
      return { warnings };
    },
  );
};
