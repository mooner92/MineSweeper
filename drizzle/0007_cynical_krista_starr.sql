CREATE TABLE `round_experts` (
	`id` text PRIMARY KEY NOT NULL,
	`round` text NOT NULL,
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
CREATE INDEX `round_experts_round_idx` ON `round_experts` (`round`);--> statement-breakpoint
CREATE TABLE `round_pools` (
	`round` text PRIMARY KEY NOT NULL,
	`filename` text,
	`count` integer DEFAULT 0 NOT NULL,
	`uploaded_at` integer NOT NULL
);
