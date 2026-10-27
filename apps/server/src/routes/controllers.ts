import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  controller,
  controllerExport,
  controllerImport,
  controllerInput,
  controllerUpdate,
  quickControl,
} from "@wled-manager/shared";

const params = z.object({ id: z.string() });

const devicePreset = z.object({ slot: z.number(), name: z.string() });

export const controllerRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = app.controllers;

  app.get("/controllers", { schema: { response: { 200: z.array(controller) } } }, async () => svc.list());

  app.post(
    "/controllers",
    { schema: { body: controllerInput, response: { 201: controller } } },
    async (req, reply) => reply.code(201).send(await svc.create(req.body)),
  );

  app.post(
    "/controllers/import",
    { schema: { body: controllerImport, response: { 201: controller } } },
    async (req, reply) => reply.code(201).send(await svc.import(req.body)),
  );

  /** The controller's setup as a downloadable file. */
  app.get("/controllers/:id/export", { schema: { params, response: { 200: controllerExport } } }, async (req, reply) => {
    const file = svc.export(req.params.id);
    const name = file.controller.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "controller";
    reply.header("content-disposition", `attachment; filename="${name}.wled-controller.json"`);
    return file;
  });

  /** Replaces the controller's layout, markers, ranges and segments with an exported file's. */
  app.put(
    "/controllers/:id/setup",
    { schema: { params, body: controllerExport, response: { 200: controller } } },
    async (req) => svc.importSetup(req.params.id, req.body),
  );

  app.get("/controllers/:id", { schema: { params, response: { 200: controller } } }, async (req) =>
    svc.get(req.params.id),
  );

  app.patch(
    "/controllers/:id",
    { schema: { params, body: controllerUpdate, response: { 200: controller } } },
    async (req) => svc.update(req.params.id, req.body),
  );

  app.delete("/controllers/:id", { schema: { params } }, async (req, reply) => {
    svc.remove(req.params.id);
    return reply.code(204).send();
  });

  app.post("/controllers/:id/refresh", { schema: { params, response: { 200: controller } } }, async (req) =>
    svc.refresh(req.params.id, { full: true }),
  );

  /** Effect and palette names as reported by the device, for editor pickers. */
  app.get(
    "/controllers/:id/catalog",
    {
      schema: {
        params,
        response: {
          200: z.object({ effects: z.array(z.string()), palettes: z.array(z.string()), fxdata: z.array(z.string()) }),
        },
      },
    },
    async (req) => {
      const row = svc.getRow(req.params.id);
      return { effects: row.effects ?? [], palettes: row.palettes ?? [], fxdata: row.fxdata ?? [] };
    },
  );

  app.get("/controllers/:id/state", { schema: { params } }, async (req) =>
    svc.client(svc.getRow(req.params.id)).getState(),
  );

  app.post("/controllers/:id/state", { schema: { params, body: quickControl } }, async (req) => {
    const client = svc.client(svc.getRow(req.params.id));
    await client.setState(req.body);
    return client.getState();
  });

  /** Presets currently stored on the device (slot + name only). Read-only. */
  app.get(
    "/controllers/:id/device-presets",
    { schema: { params, response: { 200: z.array(devicePreset) } } },
    async (req) => {
      const presets = await svc.client(svc.getRow(req.params.id)).getPresets();
      return Object.entries(presets)
        .map(([slot, p]) => ({ slot: Number(slot), name: typeof p.n === "string" ? p.n : `Preset ${slot}` }))
        .filter((p) => p.slot > 0)
        .sort((a, b) => a.slot - b.slot);
    },
  );
};
