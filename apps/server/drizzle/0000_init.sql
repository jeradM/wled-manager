CREATE TABLE `controller_palette_slots` (
	`controller_id` text NOT NULL,
	`palette_id` text NOT NULL,
	`slot` integer NOT NULL,
	PRIMARY KEY(`controller_id`, `palette_id`),
	FOREIGN KEY (`controller_id`) REFERENCES `controllers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`palette_id`) REFERENCES `palettes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `controllers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 80 NOT NULL,
	`pin` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`info` text,
	`effects` text,
	`palettes` text,
	`last_seen` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `palettes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`stops` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` integer NOT NULL,
	`name` text NOT NULL,
	`ql` text,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presets_slot_unique` ON `presets` (`slot`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`controller_id` text PRIMARY KEY NOT NULL,
	`desired_hash` text,
	`last_applied_hash` text,
	`observed_hash` text,
	`drifted` integer DEFAULT false NOT NULL,
	`last_error` text,
	`last_synced_at` text,
	FOREIGN KEY (`controller_id`) REFERENCES `controllers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`all_controllers` integer DEFAULT true NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`item_type`, `item_id`)
);
