CREATE TABLE `applicants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`recruitment_round` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`person_id` text,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`applicant_id`) REFERENCES `applicants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`folder_category` text,
	`doc_type` text DEFAULT 'unknown' NOT NULL,
	`source_format` text NOT NULL,
	`filename` text NOT NULL,
	`title` text,
	`filepath` text NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`has_text_layer` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`applicant_id`) REFERENCES `applicants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extracted_persons` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`name_raw` text NOT NULL,
	`name_normalized` text NOT NULL,
	`name_en` text,
	`name_ko` text,
	`name_initials` text,
	`role` text NOT NULL,
	`affiliation` text,
	`is_self` integer DEFAULT false NOT NULL,
	`source_kind` text DEFAULT 'printed' NOT NULL,
	`source_page` integer DEFAULT 1 NOT NULL,
	`region_bbox` text,
	`crop_path` text,
	`ocr_engine` text,
	`ocr_confidence` real,
	`confidence` real DEFAULT 0 NOT NULL,
	`needs_human` integer DEFAULT true NOT NULL,
	`verification_status` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'process_applicant' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `person_aggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`canonical_name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`affiliation` text,
	`is_self` integer DEFAULT false NOT NULL,
	`needs_human` integer DEFAULT true NOT NULL,
	`final_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`applicant_id`) REFERENCES `applicants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`document_id` text,
	`applicant_id` text NOT NULL,
	`flag_type` text NOT NULL,
	`label` text,
	`crop_path` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `extracted_persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applicant_id`) REFERENCES `applicants`(`id`) ON UPDATE no action ON DELETE cascade
);
