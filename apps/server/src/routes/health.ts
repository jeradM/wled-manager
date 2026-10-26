import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    async () => {
      app.db.get(sql`select 1`);
      return { ok: true };
    },
  );
};
