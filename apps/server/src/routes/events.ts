import type { FastifyPluginAsync } from "fastify";

/** Server-Sent Events stream of ServerEvent JSON objects. */
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get("/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const unsubscribe = app.events.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
};
