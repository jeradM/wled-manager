import { describe, expect, it } from "vitest";
import { customPaletteId, ledAtPosition, palettePosition, paletteStopsFor, stopsToWled, wledToStops } from "./palette.js";

describe("palette conversion", () => {
  const stops = [
    { pos: 255, color: "#0000ff" },
    { pos: 0, color: "#ff0000" },
    { pos: 128, color: "#00ff80" },
  ];

  it("renders sorted flat numeric form", () => {
    expect(stopsToWled(stops)).toEqual({
      palette: [0, 255, 0, 0, 128, 0, 255, 128, 255, 0, 0, 255],
    });
  });

  it("round-trips", () => {
    expect(wledToStops(stopsToWled(stops))).toEqual([...stops].sort((a, b) => a.pos - b.pos));
  });

  it("parses hex string form", () => {
    expect(wledToStops({ palette: [0, "FF0000", 255, "0000ff"] })).toEqual([
      { pos: 0, color: "#ff0000" },
      { pos: 255, color: "#0000ff" },
    ]);
  });

  it("maps slots to device palette IDs", () => {
    expect(customPaletteId(0)).toBe(255);
    expect(customPaletteId(9)).toBe(246);
    expect(customPaletteId(0, 200)).toBe(200);
    expect(customPaletteId(3, 200)).toBe(197);
  });
});

describe("palette placement", () => {
  it("spreads a palette along a run of LEDs, from its end when reversed", () => {
    const run = { start: 10, stop: 20, rev: false };
    expect(palettePosition(10, run)).toBe(0);
    expect(palettePosition(15, run)).toBe(127);
    expect(palettePosition(19, run)).toBe(229);
    expect(palettePosition(20, run)).toBeUndefined();
    expect(palettePosition(19, { ...run, rev: true })).toBe(0);
  });

  it("finds the LED showing a palette position", () => {
    const run = { start: 10, stop: 20, rev: false };
    for (const led of [10, 15, 19]) expect(ledAtPosition(palettePosition(led, run)!, run)).toBe(led);
    expect(ledAtPosition(255, run)).toBe(19);
    expect(ledAtPosition(0, { ...run, rev: true })).toBe(19);
  });

  it("uses a controller's own version of a palette", () => {
    const stops = [{ pos: 0, color: "#000000" }, { pos: 255, color: "#ffffff" }];
    const porch = [{ pos: 0, color: "#ff0000" }, { pos: 255, color: "#0000ff" }];
    const p = { stops, variants: [{ controllerId: "porch", stops: porch }] };
    expect(paletteStopsFor(p, "porch")).toBe(porch);
    expect(paletteStopsFor(p, "garage")).toBe(stops);
  });
});
