import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { settings } from "@wled-manager/shared";

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/settings", { schema: { response: { 200: settings } } }, async () => app.settings.get());

  app.put(
    "/settings",
    { schema: { body: settings.partial(), response: { 200: settings } } },
    async (req) => app.settings.update(req.body),
  );
};
