CREATE TABLE `experts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`affiliation` text,
	`position` text,
	`email` text,
	`phone` text,
	`fields` text DEFAULT '[]' NOT NULL,
	`registered_at` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experts_name_key_idx` ON `experts` (`name_key`);