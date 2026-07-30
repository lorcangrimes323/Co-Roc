CREATE TABLE `checklist_custom_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Ground support equipment' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_custom_parts_project_code_unique` ON `checklist_custom_parts` (`project_id`,`code`);--> statement-breakpoint
CREATE INDEX `checklist_custom_parts_project_idx` ON `checklist_custom_parts` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `launch_checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`mission` text DEFAULT '' NOT NULL,
	`launch_site` text DEFAULT '' NOT NULL,
	`scheduled_for` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`baseline_release_number` integer,
	`definition_json` text DEFAULT '{"sections":[]}' NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`updated_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`released_by_name` text,
	`released_by_email` text,
	`released_at` text
);
--> statement-breakpoint
CREATE INDEX `launch_checklists_project_idx` ON `launch_checklists` (`project_id`,`updated_at`);