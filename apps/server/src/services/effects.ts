import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { inlineEffect, patternLayers, patternProblem, type LayeredEffect, type LayeredEffectInput } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { layeredEffects, presets } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { NotFoundError } from "./controllers.js";

type Row = typeof layeredEffects.$inferSelect;

const toEffect = (row: Row): LayeredEffect => ({
  id: row.id,
  name: row.name,
  layers: row.layers,
  ...(row.pattern ? { pattern: row.pattern } : {}),
  revision: row.revision,
  updatedAt: row.updatedAt,
});

/** What's stored for an effect: a pattern's layers are made from its runs. */
function stored(input: LayeredEffectInput) {
  if (!input.pattern) return { name: input.name, layers: input.layers, pattern: null };
  const problem = patternProblem(input.pattern.runs);
  if (problem) throw Object.assign(new Error(problem), { statusCode: 400 });
  return { name: input.name, layers: patternLayers(input.pattern.runs), pattern: input.pattern };
}

/** Layered effects (repeating patterns among them): stacks of layers kept apart from presets, to apply to segments. */
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
      .values({ id: randomUUID(), ...stored(input) })
      .returning()
      .get();
    this.events.publish({ type: "effects.changed" });
    return toEffect(row);
  }

  update(id: string, input: LayeredEffectInput): LayeredEffect {
    this.get(id);
    const row = this.db
      .update(layeredEffects)
      .set({ ...stored(input), revision: sql`${layeredEffects.revision} + 1`, updatedAt: new Date().toISOString() })
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
