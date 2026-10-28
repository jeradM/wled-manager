import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../test-utils.js";

let cleanup: () => Promise<void>;
afterEach(() => cleanup?.());

const state = { on: true, seg: [{ fx: 0 }] };

describe("preset groups", () => {
  it("stores a preset's group, moves presets between groups, and keeps it when the slot is re-imported", async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    const create = (slot: number, folder?: string) =>
      t.app.inject({ method: "POST", url: "/api/presets", payload: { slot, name: `P${slot}`, kind: "state", state, folder } });

    const a = (await create(1, "  Holidays ")).json();
    expect(a.folder).toBe("Holidays");
    const b = (await create(2)).json();
    expect(b.folder).toBeUndefined();

    const moved = await t.app.inject({ method: "POST", url: "/api/presets/folder", payload: { ids: [a.id, b.id], folder: "Party" } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().map((p: { folder?: string }) => p.folder)).toEqual(["Party", "Party"]);

    const out = await t.app.inject({ method: "POST", url: "/api/presets/folder", payload: { ids: [b.id], folder: null } });
    expect(out.json()[0].folder).toBeUndefined();

    t.app.presets.upsertBySlot({ slot: 1, name: "Imported", kind: "state", state });
    expect(t.app.presets.get(a.id)).toMatchObject({ name: "Imported", folder: "Party" });

    const blank = await t.app.inject({ method: "POST", url: "/api/presets/folder", payload: { ids: [a.id], folder: " " } });
    expect(blank.statusCode).toBe(400);
  });
});
