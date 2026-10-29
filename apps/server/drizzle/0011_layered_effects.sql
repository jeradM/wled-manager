CREATE TABLE `layered_effects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`layers` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
