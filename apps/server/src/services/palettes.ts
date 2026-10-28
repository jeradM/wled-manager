import { randomUUID } from "node:crypto";
import { asc, eq, max, sql } from "drizzle-orm";
import type { Palette, PaletteInput } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { palettes } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { NotFoundError } from "./controllers.js";

type PaletteRow = typeof palettes.$inferSelect;

const toPalette = (row: PaletteRow): Palette => ({
  id: row.id,
  name: row.name,
  stops: row.stops,
  variants: row.variants,
  revision: row.revision,
  updatedAt: row.updatedAt,
});

export class PaletteService {
  constructor(
    private db: Db,
    private events: EventBus,
  ) {}

  /** Library palettes in sync priority order. */
  list(): Palette[] {
    return this.db.select().from(palettes).orderBy(asc(palettes.position), asc(palettes.createdAt)).all().map(toPalette);
  }

  get(id: string): Palette {
    const row = this.db.select().from(palettes).where(eq(palettes.id, id)).get();
    if (!row) throw new NotFoundError(`Palette ${id} not found`);
    return toPalette(row);
  }

  create(input: PaletteInput): Palette {
    const last = this.db.select({ value: max(palettes.position) }).from(palettes).get()?.value ?? -1;
    const row = this.db
      .insert(palettes)
      .values({ id: randomUUID(), ...input, variants: input.variants ?? [], position: last + 1 })
      .returning()
      .get();
    this.events.publish({ type: "palettes.changed" });
    return toPalette(row);
  }

  update(id: string, input: PaletteInput): Palette {
    this.get(id);
    const row = this.db
      .update(palettes)
      .set({ ...input, variants: input.variants ?? [], revision: sql`${palettes.revision} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(palettes.id, id))
      .returning()
      .get();
    this.events.publish({ type: "palettes.changed" });
    return toPalette(row);
  }

  remove(id: string) {
    this.get(id);
    this.db.delete(palettes).where(eq(palettes.id, id)).run();
    this.events.publish({ type: "palettes.changed" });
  }
}
