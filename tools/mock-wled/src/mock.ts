import Fastify from "fastify";
import multipart from "@fastify/multipart";

const EFFECTS = ["Solid", "Blink", "Breathe", "Wipe", "Wipe Random", "Random Colors", "Sweep", "Dynamic", "Colorloop", "Rainbow"];
const PALETTES = ["Default", "* Random Cycle", "* Color 1", "* Colors 1&2", "* Color Gradient", "* Colors Only", "Party", "Cloud", "Lava", "Ocean", "Forest", "Rainbow"];
const FXDATA = ["", "!,Duty cycle;!,!;!;01", "!;!,!;!;01", "!,!;!,!;!", "!;;!", "!,Fade time;;!;01", "!,!;!,!;!", "!,!,,,,Smooth;;!", "!,Saturation;;!;01", "!,Size;;!"];

export interface MockOptions {
  name?: string;
  ledCount?: number;
  version?: string;
  rgbw?: boolean;
  /** Reported as info.cpalmax; omit to mimic upstream firmware that doesn't report it. */
  customPaletteMax?: number;
  /** Artificial response delay, to make request overlap observable in tests. */
  delayMs?: number;
}

/**
 * In-memory stand-in for a WLED controller, covering the subset of the HTTP API the manager uses.
 * `files` is exposed so tests can inspect or tamper with device storage (e.g. to simulate drift).
 */
export function createMockWled({
  name = "Mock WLED",
  ledCount = 60,
  version = "0.15.0",
  rgbw = true,
  customPaletteMax = 10,
  delayMs = 0,
}: MockOptions = {}) {
  const files = new Map<string, string>([["/presets.json", JSON.stringify({ "0": {} })]]);
  let state: Record<string, unknown> = {
    on: true,
    bri: 128,
    transition: 7,
    ps: -1,
    seg: [{ id: 0, start: 0, stop: ledCount, fx: 0, sx: 128, ix: 128, pal: 0, col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }],
  };

  const presets = () => JSON.parse(files.get("/presets.json")!) as Record<string, unknown>;
  const writePresets = (p: Record<string, unknown>) => files.set("/presets.json", JSON.stringify(p));
  const customPalettes = () =>
    [...files.keys()].filter((f) => /^\/palette\d+\.json$/.test(f)).length;

  const info = () => ({
    ver: version,
    name,
    product: "Mock",
    leds: { count: ledCount, rgbw },
    arch: "esp32",
    mac: "aabbccddeeff",
    fxcount: EFFECTS.length,
    palcount: PALETTES.length + customPalettes(),
    cpalcount: customPalettes(),
    ...(customPaletteMax !== undefined ? { cpalmax: customPaletteMax } : {}),
  });

  const app = Fastify({ logger: false });
  const writes: string[] = [];
  let requests = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  app.addHook("onRequest", async (req) => {
    requests++;
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    if (req.method !== "GET") writes.push(`${req.method} ${req.url}`);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  });
  app.addHook("onResponse", async () => {
    inFlight--;
  });
  app.register(multipart);

  app.get("/json", async () => ({ state, info: info(), effects: EFFECTS, palettes: PALETTES }));
  app.get("/json/info", async () => info());
  app.get("/json/state", async () => state);
  app.get("/json/eff", async () => EFFECTS);
  app.get("/json/pal", async () => PALETTES);
  app.get("/json/fxdata", async () => FXDATA);

  app.get<{ Querystring: { list?: string } }>("/edit", async (req, reply) => {
    if (req.query.list === undefined) return reply.code(404).send("Not found");
    return [...files].map(([f, content]) => ({ name: f.slice(1), type: "file", size: content.length }));
  });

  app.post<{ Body: Record<string, unknown> }>("/json/state", async (req) => {
    const { psave, pdel, n, o, ib, sb, ql, ...rest } = req.body ?? {};
    if (typeof pdel === "number") {
      const p = presets();
      delete p[String(pdel)];
      writePresets(p);
    }
    if (typeof psave === "number") {
      const p = presets();
      // "o": save the request body as the preset; otherwise snapshot current state.
      p[String(psave)] = { n, ...(ql ? { ql } : {}), ...(o ? rest : state) };
      writePresets(p);
    } else if (typeof pdel !== "number") {
      state = { ...state, ...rest };
    }
    return { success: true };
  });

  app.get<{ Params: { file: string } }>("/:file", async (req, reply) => {
    const content = files.get(`/${req.params.file}`);
    if (content === undefined) return reply.code(404).send("Not found");
    return reply.type("application/json").send(content);
  });

  app.post("/upload", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send("No file");
    const filename = part.filename.startsWith("/") ? part.filename : `/${part.filename}`;
    files.set(filename, (await part.toBuffer()).toString("utf8"));
    return reply.send("File Uploaded!");
  });

  app.delete<{ Querystring: { path?: string } }>("/edit", async (req, reply) => {
    const path = req.query.path;
    if (!path || !files.delete(path)) return reply.code(404).send("Not found");
    return reply.send("File deleted");
  });

  return { app, files, writes, getState: () => state, requestCount: () => requests, maxInFlight: () => maxInFlight };
}
