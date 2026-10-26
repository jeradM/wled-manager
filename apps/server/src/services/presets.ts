import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { Preset, PresetInput } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { presets } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { NotFoundError } from "./controllers.js";

type PresetRow = typeof presets.$inferSelect;

export class SlotTakenError extends Error {}

const toPreset = (row: PresetRow): Preset => ({
  id: row.id,
  slot: row.slot,
  name: row.name,
  ...(row.ql ? { ql: row.ql } : {}),
  kind: row.kind,
  ...(row.state ? { state: row.state } : {}),
  ...(row.raw ? { raw: row.raw } : {}),
  revision: row.revision,
  updatedAt: row.updatedAt,
});

/** Columns for a preset input; clears the payload of the other kind. */
const columns = (input: PresetInput) => ({
  slot: input.slot,
  name: input.name,
  ql: input.ql ?? null,
  kind: input.kind,
  state: input.kind === "state" ? input.state! : null,
  raw: input.kind === "raw" ? input.raw! : null,
});

export class PresetService {
  constructor(
    private db: Db,
    private events: EventBus,
  ) {}

  list(): Preset[] {
    return this.db.select().from(presets).orderBy(asc(presets.slot)).all().map(toPreset);
  }

  get(id: string): Preset {
    const row = this.db.select().from(presets).where(eq(presets.id, id)).get();
    if (!row) throw new NotFoundError(`Preset ${id} not found`);
    return toPreset(row);
  }

  bySlot(slot: number): Preset | undefined {
    const row = this.db.select().from(presets).where(eq(presets.slot, slot)).get();
    return row && toPreset(row);
  }

  create(input: PresetInput): Preset {
    this.assertSlotFree(input.slot);
    const row = this.db.insert(presets).values({ id: randomUUID(), ...columns(input) }).returning().get();
    this.events.publish({ type: "presets.changed" });
    return toPreset(row);
  }

  update(id: string, input: PresetInput): Preset {
    this.get(id);
    this.assertSlotFree(input.slot, id);
    const row = this.db
      .update(presets)
      .set({ ...columns(input), revision: sql`${presets.revision} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(presets.id, id))
      .returning()
      .get();
    this.events.publish({ type: "presets.changed" });
    return toPreset(row);
  }

  /** Creates the preset, or replaces whatever preset occupies its slot. */
  upsertBySlot(input: PresetInput): Preset {
    const existing = this.bySlot(input.slot);
    return existing ? this.update(existing.id, input) : this.create(input);
  }

  remove(id: string) {
    this.get(id);
    this.db.delete(presets).where(eq(presets.id, id)).run();
    this.events.publish({ type: "presets.changed" });
  }

  private assertSlotFree(slot: number, exceptId?: string) {
    const taken = this.bySlot(slot);
    if (taken && taken.id !== exceptId) throw new SlotTakenError(`Slot ${slot} is already used by "${taken.name}"`);
  }
}
