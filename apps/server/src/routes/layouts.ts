import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { layout, layoutInput } from "@wled-manager/shared";

const params = z.object({ id: z.string() });
export const LAYOUT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const layoutRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = app.layouts;
  // Pictures are uploaded as the request body itself.
  app.addContentTypeParser(LAYOUT_IMAGE_TYPES, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));

  app.get("/layouts", { schema: { response: { 200: z.array(layout) } } }, async () => svc.list());

  app.post("/layouts", { schema: { body: layoutInput, response: { 201: layout } } }, async (req, reply) =>
    reply.code(201).send(svc.create(req.body)),
  );

  app.get("/layouts/:id", { schema: { params, response: { 200: layout } } }, async (req) => svc.get(req.params.id));

  app.put("/layouts/:id", { schema: { params, body: layoutInput, response: { 200: layout } } }, async (req) =>
    svc.update(req.params.id, req.body),
  );

  app.delete("/layouts/:id", { schema: { params } }, async (req, reply) => {
    svc.remove(req.params.id);
    return reply.code(204).send();
  });

  /** Stores the picture: PNG, JPEG, WebP or GIF as the body, with its size in pixels (read by the browser). */
  app.put(
    "/layouts/:id/image",
    {
      schema: {
        params,
        querystring: z.object({ width: z.coerce.number().int().min(1).max(20000), height: z.coerce.number().int().min(1).max(20000) }),
        response: { 200: layout, 415: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      const type = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
      if (!LAYOUT_IMAGE_TYPES.includes(type) || !Buffer.isBuffer(req.body) || req.body.length === 0)
        return reply.code(415).send({ error: "Send a PNG, JPEG, WebP or GIF image" });
      return svc.setImage(req.params.id, { data: req.body, type, width: req.query.width, height: req.query.height });
    },
  );

  app.delete("/layouts/:id/image", { schema: { params, response: { 200: layout } } }, async (req) => svc.setImage(req.params.id, null));

  app.get("/layouts/:id/image", { schema: { params } }, async (req, reply) => {
    const image = svc.image(req.params.id);
    if (!image) return reply.code(404).send({ error: "This layout has no picture" });
    const etag = `"${req.params.id}-${image.revision}"`;
    reply.header("etag", etag).header("cache-control", "no-cache");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(image.type).send(image.data);
  });
};
