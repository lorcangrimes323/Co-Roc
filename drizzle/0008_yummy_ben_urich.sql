CREATE TABLE `ork_release_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`working_version` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`requested_by_name` text NOT NULL,
	`requested_by_email` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_by_name` text,
	`reviewed_by_email` text,
	`reviewed_at` text,
	`release_number` integer
);
--> statement-breakpoint
CREATE INDEX `ork_release_requests_project_idx` ON `ork_release_requests` (`project_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `ork_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`release_number` integer NOT NULL,
	`working_version` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ork_releases_project_number_unique` ON `ork_releases` (`project_id`,`release_number`);--> statement-breakpoint
CREATE INDEX `ork_releases_project_idx` ON `ork_releases` (`project_id`,`created_at`);