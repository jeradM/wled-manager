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
  /** Mimic upstream WLED main: palette IDs from 200 down, umpalcount in info, rmcpal command. */
  modernPalettes?: boolean;
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
  modernPalettes = false,
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

  const info = () => ({
    ver: version,
    name,
    product: "Mock",
    leds: { count: ledCount, rgbw },
    arch: "esp32",
    mac: "aabbccddeeff",
    fxcount: EFFECTS.length,
    palcount: PALETTES.length + loadedPalettes.length,
    cpalcount: loadedPalettes.length,
    ...(customPaletteMax !== undefined ? { cpalmax: customPaletteMax } : {}),
    ...(modernPalettes ? { umpalcount: 0 } : {}),
  });

  // Palettes as the firmware has loaded them. Like real WLED, this only changes when palettes are
  // reloaded (palette upload or rmcpal), not when a file is deleted directly.
  let loadedPalettes: string[] = [];
  const reloadPalettes = () => {
    loadedPalettes = [];
    for (let i = 0; i < 20; i++) loadedPalettes.push(files.get(`/palette${i}.json`) ?? "");
    while (loadedPalettes.length && !loadedPalettes.at(-1)) loadedPalettes.pop();
  };
  const base = modernPalettes ? 200 : 255;

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

  app.get<{ Querystring: { page?: string } }>("/json/palx", async (req) => {
    const p: Record<string, unknown> = {};
    PALETTES.forEach((_, id) => {
      p[id] = id < 6 ? ["c1", "c2"] : [[0, id * 10, 0, 0], [255, 0, 0, id * 10]];
    });
    loadedPalettes.forEach((content, i) => {
      if (content) p[base - i] = (JSON.parse(content).palette as unknown[]).length ? [[0, 1, 2, 3], [255, 4, 5, 6]] : [];
    });
    return { m: 0, p };
  });

  app.get<{ Querystring: { list?: string; func?: string; path?: string } }>("/edit", async (req, reply) => {
    const { list, func, path } = req.query;
    if (list !== undefined || func === "list")
      return [...files].map(([f, content]) => ({ name: f.slice(1), type: "file", size: content.length }));
    if (func === "delete" && path) {
      writes.push(`DELETE ${path}`);
      if (!files.delete(path)) return reply.code(404).send("File not found");
      return reply.send("File deleted");
    }
    return reply.code(404).send("Not found");
  });

  app.post<{ Body: Record<string, unknown> }>("/json/state", async (req) => {
    const { psave, pdel, n, o, ib, sb, ql, rmcpal, ...rest } = req.body ?? {};
    if (typeof rmcpal === "number" && modernPalettes) {
      files.delete(`/palette${rmcpal}.json`);
      reloadPalettes();
      return { success: true };
    }
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
    if (filename.includes("palette") && filename.endsWith(".json")) reloadPalettes();
    return reply.send("File Uploaded!");
  });

  // Legacy delete; real older firmware may expect the path as a form field instead.
  app.delete<{ Querystring: { path?: string } }>("/edit", async (req, reply) => {
    const path = req.query.path;
    if (!path || !files.delete(path)) return reply.code(404).send("Not found");
    return reply.send("File deleted");
  });

  return { app, files, writes, getState: () => state, requestCount: () => requests, maxInFlight: () => maxInFlight, loadedPalettes: () => loadedPalettes.length, palettesInMemory: () => [...loadedPalettes] };
}
