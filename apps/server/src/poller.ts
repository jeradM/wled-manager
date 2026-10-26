import type { FastifyBaseLogger } from "fastify";
import type { ControllerService } from "./services/controllers.js";

/** Periodically refreshes every controller's status. Devices are polled in parallel; each device's requests are serialized by the client. */
export function startPoller(service: ControllerService, intervalMs: number, log: FastifyBaseLogger) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await Promise.allSettled(service.list().map((c) => service.refresh(c.id)));
    } catch (e) {
      log.error(e, "controller poll failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(timer);
}
