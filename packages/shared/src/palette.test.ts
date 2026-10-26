import { describe, expect, it } from "vitest";
import { customPaletteId, stopsToWled, wledToStops } from "./palette.js";

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
