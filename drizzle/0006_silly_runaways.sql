CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`name` text NOT NULL,
	`affiliation` text,
	`position` text,
	`email` text,
	`phone` text,
	`fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`applicant_id`) REFERENCES `applicants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `applicants` ADD `field_dae` text;--> statement-breakpoint
ALTER TABLE `applicants` ADD `field_mid` text;