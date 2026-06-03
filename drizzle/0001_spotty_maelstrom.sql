ALTER TABLE `extracted_persons` ADD `name_candidates` text;--> statement-breakpoint
ALTER TABLE `person_aggregates` ADD `name_candidates` text DEFAULT '[]' NOT NULL;