import { z } from "zod";

/** The subset of /json/info the manager relies on. Everything else is kept as-is in the cached info blob. */
export const wledInfo = z.looseObject({
  ver: z.string(),
  name: z.string().optional(),
  arch: z.string().optional(),
  mac: z.string().optional(),
  product: z.string().optional(),
  brand: z.string().optional(),
  fxcount: z.number().optional(),
  palcount: z.number().optional(),
  cpalcount: z.number().optional(),
  cpalmax: z.number().optional(),
  leds: z.looseObject({ count: z.number(), rgbw: z.boolean().optional() }),
});
export type WledInfo = z.infer<typeof wledInfo>;

export const wledFile = z.object({ name: z.string(), type: z.string(), size: z.number() });
export type WledFile = z.infer<typeof wledFile>;

/** Firmware without cpalmax in /json/info (upstream 0.14/0.15) supports 10 custom palettes. */
export const DEFAULT_CUSTOM_PALETTE_MAX = 10;

export class WledError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "WledError";
  }
}

export interface WledClientOptions {
  timeoutMs?: number;
  retries?: number;
}

// ESP boards handle concurrent HTTP poorly, so all requests to one device run strictly one at a time.
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WledClient {
  readonly baseUrl: string;
  private timeoutMs: number;
  private retries: number;

  constructor(host: string, port = 80, { timeoutMs = 5000, retries = 2 }: WledClientOptions = {}) {
    this.baseUrl = `http://${host}${port === 80 ? "" : `:${port}`}`;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  // ---- Reads (idempotent, retried) ----

  async getInfo(): Promise<WledInfo> {
    return wledInfo.parse(await this.getJson("/json/info"));
  }

  getState(): Promise<Record<string, unknown>> {
    return this.getJson("/json/state");
  }

  async getEffects(): Promise<string[]> {
    return z.array(z.string()).parse(await this.getJson("/json/eff"));
  }

  async getPalettes(): Promise<string[]> {
    return z.array(z.string()).parse(await this.getJson("/json/pal"));
  }

  /** Per-effect metadata strings (slider/option labels), indexed like /json/eff. */
  async getFxData(): Promise<string[]> {
    return z.array(z.string()).parse(await this.getJson("/json/fxdata"));
  }

  async getPresets(): Promise<Record<string, Record<string, unknown>>> {
    return (await this.getFileJson("/presets.json")) ?? {};
  }

  async listFiles(): Promise<WledFile[]> {
    return z.array(wledFile).parse(await this.getJson("/edit?list=/"));
  }

  /** Reads a file from the device filesystem; null if it doesn't exist. */
  async getFile(path: string): Promise<string | null> {
    try {
      return await this.request("GET", path, { retry: true, parse: "text" });
    } catch (e) {
      if (e instanceof WledError && e.status === 404) return null;
      throw e;
    }
  }

  async getFileJson<T = any>(path: string): Promise<T | null> {
    const text = await this.getFile(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WledError(`Invalid JSON in ${path}`);
    }
  }

  // ---- Writes (never retried: a timed-out write may still have been applied) ----

  setState(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/json/state", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      parse: "json",
    });
  }

  uploadFile(path: string, content: string): Promise<string> {
    const form = new FormData();
    form.append("data", new Blob([content], { type: "application/json" }), path);
    return this.request("POST", "/upload", { body: form, parse: "text" });
  }

  deleteFile(path: string): Promise<string> {
    return this.request("DELETE", `/edit?path=${encodeURIComponent(path)}`, { parse: "text" });
  }

  // ---- Internals ----

  private getJson<T = any>(path: string): Promise<T> {
    return this.request("GET", path, { retry: true, parse: "json" });
  }

  private request<T>(
    method: string,
    path: string,
    opts: { body?: BodyInit; headers?: Record<string, string>; retry?: boolean; parse: "json" | "text" },
  ): Promise<T> {
    return enqueue(this.baseUrl, async () => {
      const attempts = opts.retry ? this.retries + 1 : 1;
      let lastError: unknown;
      for (let i = 0; i < attempts; i++) {
        if (i > 0) await sleep(250 * 2 ** (i - 1));
        try {
          const res = await fetch(this.baseUrl + path, {
            method,
            body: opts.body,
            headers: opts.headers,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (!res.ok) {
            // Drain the body; WLED's 404 page is gzip HTML and not useful as a message.
            await res.arrayBuffer().catch(() => {});
            const err = new WledError(`${method} ${path} failed: HTTP ${res.status}`, res.status);
            // Client errors won't improve with a retry.
            if (res.status < 500) throw err;
            lastError = err;
            continue;
          }
          return (opts.parse === "json" ? await res.json() : await res.text()) as T;
        } catch (e) {
          if (e instanceof WledError && e.status !== undefined && e.status < 500) throw e;
          lastError = e;
        }
      }
      throw toWledError(lastError, `${method} ${this.baseUrl}${path}`);
    });
  }
}

function toWledError(e: unknown, what: string): WledError {
  if (e instanceof WledError) return e;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
    return new WledError(`${what}: timed out`);
  const cause = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e);
  return new WledError(`${what}: ${cause}`);
}
