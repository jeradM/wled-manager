import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMock } from "../test-utils.js";
import { WledClient, WledError } from "./client.js";

let mock: Awaited<ReturnType<typeof startMock>>;
let client: WledClient;

beforeAll(async () => {
  mock = await startMock({ customPaletteMax: 183 });
  client = new WledClient(mock.host, mock.port, { timeoutMs: 500, retries: 0 });
});
afterAll(() => mock.stop());

describe("WledClient", () => {
  it("reads info, catalogs and files", async () => {
    const info = await client.getInfo();
    expect(info.cpalmax).toBe(183);
    expect(info.leds.rgbw).toBe(true);
    expect((await client.getEffects())[0]).toBe("Solid");
    expect(await client.getFxData()).toHaveLength((await client.getEffects()).length);
    expect((await client.listFiles()).map((f) => f.name)).toContain("presets.json");
  });

  it("returns null for missing files and throws on other HTTP errors", async () => {
    expect(await client.getFile("/palette7.json")).toBeNull();
    await expect(client.getFileJson("/nope.json")).resolves.toBeNull();
  });

  it("uploads and deletes files", async () => {
    await client.uploadFile("/palette0.json", '{"palette":[0,"ff0000",255,"0000ff"]}');
    expect(await client.getFileJson("/palette0.json")).toEqual({ palette: [0, "ff0000", 255, "0000ff"] });
    await client.deleteFile("/palette0.json");
    expect(await client.getFile("/palette0.json")).toBeNull();
  });

  it("serializes concurrent requests to one device", async () => {
    const slow = await startMock({ delayMs: 20 });
    try {
      const c = new WledClient(slow.host, slow.port, { timeoutMs: 1000, retries: 0 });
      await Promise.all([c.getInfo(), c.getEffects(), c.getPalettes(), c.getPresets()]);
      expect(slow.requestCount()).toBe(4);
      expect(slow.maxInFlight()).toBe(1);
    } finally {
      await slow.stop();
    }
  });

  it("reports unreachable devices as WledError", async () => {
    const dead = new WledClient("127.0.0.1", 1, { timeoutMs: 300, retries: 0 });
    await expect(dead.getInfo()).rejects.toBeInstanceOf(WledError);
  });
});
