import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { inlineEffect, type LayeredEffect, type LayeredEffectInput } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { layeredEffects, presets } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { NotFoundError } from "./controllers.js";

type Row = typeof layeredEffects.$inferSelect;

const toEffect = (row: Row): LayeredEffect => ({
  id: row.id,
  name: row.name,
  layers: row.layers,
  revision: row.revision,
  updatedAt: row.updatedAt,
});

/** Layered effects: stacks of layers kept apart from presets, to apply to segments. */
export class LayeredEffectService {
  constructor(
    private db: Db,
    private events: EventBus,
  ) {}

  list(): LayeredEffect[] {
    return this.db.select().from(layeredEffects).orderBy(asc(layeredEffects.name)).all().map(toEffect);
  }

  get(id: string): LayeredEffect {
    const row = this.db.select().from(layeredEffects).where(eq(layeredEffects.id, id)).get();
    if (!row) throw new NotFoundError(`Layered effect ${id} not found`);
    return toEffect(row);
  }

  create(input: LayeredEffectInput): LayeredEffect {
    const row = this.db
      .insert(layeredEffects)
      .values({ id: randomUUID(), name: input.name, layers: input.layers })
      .returning()
      .get();
    this.events.publish({ type: "effects.changed" });
    return toEffect(row);
  }

  update(id: string, input: LayeredEffectInput): LayeredEffect {
    this.get(id);
    const row = this.db
      .update(layeredEffects)
      .set({ name: input.name, layers: input.layers, revision: sql`${layeredEffects.revision} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(layeredEffects.id, id))
      .returning()
      .get();
    this.events.publish({ type: "effects.changed" });
    return toEffect(row);
  }

  /** Deletes the effect. Presets linked to it keep copies of its layers, so they still look the same. */
  remove(id: string) {
    const effect = this.get(id);
    let presetsChanged = false;
    this.db.transaction((tx) => {
      for (const row of tx.select().from(presets).all()) {
        if (!row.state) continue;
        const seg = inlineEffect(row.state.seg, id, effect.layers);
        if (JSON.stringify(seg) === JSON.stringify(row.state.seg)) continue;
        tx.update(presets)
          .set({ state: { ...row.state, seg }, revision: sql`${presets.revision} + 1`, updatedAt: new Date().toISOString() })
          .where(eq(presets.id, row.id))
          .run();
        presetsChanged = true;
      }
      tx.delete(layeredEffects).where(eq(layeredEffects.id, id)).run();
    });
    this.events.publish({ type: "effects.changed" });
    if (presetsChanged) this.events.publish({ type: "presets.changed" });
  }
}
