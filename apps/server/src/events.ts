import { EventEmitter } from "node:events";
import type { ServerEvent } from "@wled-manager/shared";

/** In-process bus for pushing changes to connected UIs over SSE. */
export class EventBus {
  private emitter = new EventEmitter().setMaxListeners(0);

  publish(event: ServerEvent) {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: ServerEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
