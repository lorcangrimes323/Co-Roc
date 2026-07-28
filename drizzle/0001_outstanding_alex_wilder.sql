CREATE TABLE `component_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`revision` text DEFAULT 'A' NOT NULL,
	`status` text DEFAULT 'current' NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`ork_version` integer,
	`supersedes_id` integer,
	`uploaded_by_name` text NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `component_artifacts_object_key_unique` ON `component_artifacts` (`object_key`);--> statement-breakpoint
CREATE INDEX `component_artifacts_component_idx` ON `component_artifacts` (`project_id`,`component_id`,`id`);--> statement-breakpoint
CREATE TABLE `component_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`body` text NOT NULL,
	`mentions_json` text DEFAULT '[]' NOT NULL,
	`ork_version` integer,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `component_comments_component_idx` ON `component_comments` (`project_id`,`component_id`,`id`);--> statement-breakpoint
CREATE TABLE `component_record_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`ork_version` integer,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `component_record_events_component_idx` ON `component_record_events` (`project_id`,`component_id`,`id`);--> statement-breakpoint
CREATE TABLE `component_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`title` text NOT NULL,
	`requirement` text NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`owner_name` text NOT NULL,
	`owner_email` text NOT NULL,
	`completion_notes` text,
	`completed_by_name` text,
	`completed_by_email` text,
	`completed_at` text,
	`evidence_artifact_id` integer,
	`ork_version` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `component_tests_component_idx` ON `component_tests` (`project_id`,`component_id`,`id`);--> statement-breakpoint
CREATE TABLE `ork_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`field` text NOT NULL,
	`previous_value` text NOT NULL,
	`next_value` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ork_changes_project_version_field_unique` ON `ork_changes` (`project_id`,`version`,`component_id`,`field`);--> statement-breakpoint
CREATE INDEX `ork_changes_project_id_idx` ON `ork_changes` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `ork_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ork_snapshots_project_version_unique` ON `ork_snapshots` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `ork_workspaces` (
	`project_id` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`original_object_key` text NOT NULL,
	`current_object_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sha256` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`updated_by_email` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
