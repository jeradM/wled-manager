CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lines` text NOT NULL,
	`led_size` integer DEFAULT 8 NOT NULL,
	`image` blob,
	`image_type` text,
	`image_width` integer,
	`image_height` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
