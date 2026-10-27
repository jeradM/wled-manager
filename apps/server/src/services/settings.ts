import { settings as settingsTable } from "../db/schema.js";
import type { Settings } from "@wled-manager/shared";
import type { Db } from "../db/index.js";
import type { EventBus } from "../events.js";

type Listener = (s: Settings) => void;

/** Settings saved from the UI, falling back to the defaults the server was started with (env vars). */
export class SettingsService {
  private listeners: Listener[] = [];

  constructor(
    private db: Db,
    private events: EventBus,
    private defaults: Settings,
  ) {}

  get(): Settings {
    const saved = Object.fromEntries(this.db.select().from(settingsTable).all().map((r) => [r.key, r.value]));
    return { ...this.defaults, ...saved } as Settings;
  }

  update(patch: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      this.db
        .insert(settingsTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
        .run();
    }
    const next = this.get();
    for (const l of this.listeners) l(next);
    this.events.publish({ type: "settings.changed" });
    return next;
  }

  onChange(listener: Listener) {
    this.listeners.push(listener);
  }
}
