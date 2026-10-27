import type { FastifyBaseLogger } from "fastify";
import type { LedSpan } from "@wled-manager/shared";
import type { ControllerService } from "./controllers.js";
import { WledError } from "../wled/client.js";

interface Session {
  /** /json/state when the session started, restored when it ends. */
  snapshot: Record<string, unknown>;
  ledCount: number;
  timer: NodeJS.Timeout;
}

const IDLE_RESTORE_MS = 10 * 60_000;

// Read-only or bookkeeping fields in /json/state that shouldn't be posted back.
const STATE_SKIP = new Set(["ps", "pl", "lor", "udpn", "nl"]);
const SEGMENT_SKIP = new Set(["len"]);

/**
 * Lights one LED at a time so you can see where each LED index is. A session takes over the controller:
 * segment 0 is stretched over every LED with grouping, spacing and mirroring off, other segments are
 * switched off, and individual LED control freezes the segment. Ending the session (or 10 idle minutes)
 * restores the state saved at the start.
 */
export class LocatorService {
  private sessions = new Map<string, Session>();

  constructor(
    private controllers: ControllerService,
    private log: FastifyBaseLogger,
  ) {}

  isActive(controllerId: string) {
    return this.sessions.has(controllerId);
  }

  async start(controllerId: string): Promise<{ ledCount: number }> {
    const existing = this.sessions.get(controllerId);
    if (existing) {
      this.touch(controllerId, existing);
      return { ledCount: existing.ledCount };
    }

    const client = this.client(controllerId);
    const info = await client.getInfo();
    if ((info.leds as Record<string, unknown>).matrix) throw new WledError("The LED locator doesn't support 2D matrix setups yet", 409);
    const snapshot = await client.getState();
    const ledCount = info.leds.count;
    const segments = Array.isArray(snapshot.seg) ? (snapshot.seg as Record<string, unknown>[]) : [];

    const session: Session = { snapshot, ledCount, timer: setTimeout(() => {}, 0) };
    this.sessions.set(controllerId, session);
    this.touch(controllerId, session);

    await client.setState({
      on: true,
      bri: Math.max(Number(snapshot.bri) || 0, 128),
      transition: 0,
      mainseg: 0,
      seg: [
        { id: 0, start: 0, stop: ledCount, grp: 1, spc: 0, of: 0, rev: false, mi: false, on: true, bri: 255, frz: false },
        ...segments.filter((s) => s.id !== 0).map((s) => ({ id: s.id, on: false })),
      ],
    });
    return { ledCount };
  }

  /** Lights the LEDs in `spans` in `color` ("rrggbb"); every other LED is off. */
  async show(controllerId: string, spans: LedSpan[], color: string): Promise<void> {
    const session = this.sessions.get(controllerId);
    if (!session) throw new WledError("No locator session is running for this controller", 409);
    const outside = spans.find((s) => s.stop > session.ledCount);
    if (outside) throw new WledError(`LED ${outside.stop - 1} is out of range (0–${session.ledCount - 1})`, 409);
    this.touch(controllerId, session);
    const hex = color.replace(/^#/, "");
    // seg.i takes [start, stop, color] runs; blank the whole strip first.
    await this.client(controllerId).setState({
      seg: { id: 0, i: [0, session.ledCount, "000000", ...spans.flatMap((s) => [s.start, s.stop, hex])] },
    });
  }

  async stop(controllerId: string): Promise<void> {
    const session = this.sessions.get(controllerId);
    if (!session) return;
    clearTimeout(session.timer);
    this.sessions.delete(controllerId);
    await this.restore(controllerId, session.snapshot);
  }

  async stopAll() {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  private async restore(controllerId: string, snapshot: Record<string, unknown>) {
    const client = this.client(controllerId);
    const state = Object.fromEntries(Object.entries(snapshot).filter(([k, v]) => !STATE_SKIP.has(k) && typeof v !== "object"));
    const seg = (Array.isArray(snapshot.seg) ? (snapshot.seg as Record<string, unknown>[]) : []).map((s) =>
      Object.fromEntries(Object.entries(s).filter(([k]) => !SEGMENT_SKIP.has(k))),
    );
    // Individual LED control froze segment 0; put back the user's own freeze setting (normally off).
    if (seg[0] && seg[0].frz === undefined) seg[0].frz = false;
    await client.setState({ ...state, transition: 0, seg });
    // A running playlist isn't part of the state; restart it.
    if (typeof snapshot.pl === "number" && snapshot.pl > 0) await client.setState({ ps: snapshot.pl });
  }

  private touch(controllerId: string, session: Session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      this.log.info({ controllerId }, "locator idle; restoring controller state");
      this.stop(controllerId).catch((e) => this.log.error(e, "locator restore failed"));
    }, IDLE_RESTORE_MS);
    session.timer.unref();
  }

  private client(controllerId: string) {
    return this.controllers.client(this.controllers.getRow(controllerId));
  }
}
