import { randomUUID } from "node:crypto";
import { asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Layout, LayoutInput } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import { layouts } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { NotFoundError } from "./controllers.js";

/** Every column but the image itself, which is only read when it's served. */
const { image: _image, ...listed } = getTableColumns(layouts);
type Row = Omit<typeof layouts.$inferSelect, "image">;

const toLayout = (row: Row): Layout => ({
  id: row.id,
  name: row.name,
  lines: row.lines,
  ledSize: row.ledSize,
  image: row.imageType && row.imageWidth && row.imageHeight ? { type: row.imageType, width: row.imageWidth, height: row.imageHeight } : null,
  revision: row.revision,
  updatedAt: row.updatedAt,
});

/** Layouts: lights drawn as straight lines on a picture, for viewing effects where the lights really are. */
export class LayoutService {
  constructor(
    private db: Db,
    private events: EventBus,
  ) {}

  list(): Layout[] {
    return this.db.select(listed).from(layouts).orderBy(asc(layouts.name)).all().map(toLayout);
  }

  get(id: string): Layout {
    const row = this.db.select(listed).from(layouts).where(eq(layouts.id, id)).get();
    if (!row) throw new NotFoundError(`Layout ${id} not found`);
    return toLayout(row);
  }

  create(input: LayoutInput): Layout {
    const row = this.db.insert(layouts).values({ id: randomUUID(), ...input }).returning(listed).get();
    this.events.publish({ type: "layouts.changed" });
    return toLayout(row);
  }

  update(id: string, input: LayoutInput): Layout {
    return this.change(id, { name: input.name, lines: input.lines, ledSize: input.ledSize });
  }

  /** Stores the picture (or removes it, with null). */
  setImage(id: string, image: { data: Buffer; type: string; width: number; height: number } | null): Layout {
    return this.change(
      id,
      image
        ? { image: image.data, imageType: image.type, imageWidth: image.width, imageHeight: image.height }
        : { image: null, imageType: null, imageWidth: null, imageHeight: null },
    );
  }

  /** The picture's bytes and type, or undefined if the layout has none. */
  image(id: string): { data: Buffer; type: string; revision: number } | undefined {
    const row = this.db
      .select({ image: layouts.image, type: layouts.imageType, revision: layouts.revision })
      .from(layouts)
      .where(eq(layouts.id, id))
      .get();
    if (!row) throw new NotFoundError(`Layout ${id} not found`);
    return row.image && row.type ? { data: row.image, type: row.type, revision: row.revision } : undefined;
  }

  remove(id: string) {
    this.get(id);
    this.db.delete(layouts).where(eq(layouts.id, id)).run();
    this.events.publish({ type: "layouts.changed" });
  }

  private change(id: string, values: Partial<typeof layouts.$inferInsert>): Layout {
    this.get(id);
    const row = this.db
      .update(layouts)
      .set({ ...values, revision: sql`${layouts.revision} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(layouts.id, id))
      .returning(listed)
      .get();
    this.events.publish({ type: "layouts.changed" });
    return toLayout(row);
  }
}
