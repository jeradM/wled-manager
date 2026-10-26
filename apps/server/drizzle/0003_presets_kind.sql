PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` integer NOT NULL,
	`name` text NOT NULL,
	`ql` text,
	`kind` text DEFAULT 'state' NOT NULL,
	`state` text,
	`raw` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_presets`("id", "slot", "name", "ql", "state", "revision", "created_at", "updated_at") SELECT "id", "slot", "name", "ql", "state", "revision", "created_at", "updated_at" FROM `presets`;--> statement-breakpoint
DROP TABLE `presets`;--> statement-breakpoint
ALTER TABLE `__new_presets` RENAME TO `presets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `presets_slot_unique` ON `presets` (`slot`);--> statement-breakpoint
ALTER TABLE `sync_state` ADD `written_presets` text DEFAULT '{}' NOT NULL;