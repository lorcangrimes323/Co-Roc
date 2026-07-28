CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text DEFAULT 'review' NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_object_key_unique` ON `documents` (`object_key`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
