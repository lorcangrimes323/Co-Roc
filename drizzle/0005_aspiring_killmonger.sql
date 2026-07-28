CREATE TABLE `invite_code_projects` (
	`invite_code_id` text NOT NULL,
	`project_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_code_projects_unique` ON `invite_code_projects` (`invite_code_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `invite_code_projects_project_idx` ON `invite_code_projects` (`project_id`,`invite_code_id`);--> statement-breakpoint
CREATE TABLE `member_project_access` (
	`team_id` text NOT NULL,
	`member_email` text NOT NULL,
	`project_id` text NOT NULL,
	`granted_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_project_access_unique` ON `member_project_access` (`team_id`,`member_email`,`project_id`);--> statement-breakpoint
CREATE INDEX `member_project_access_project_idx` ON `member_project_access` (`project_id`,`member_email`);--> statement-breakpoint
CREATE TABLE `team_invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_hint` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invite_codes_code_hash_unique` ON `team_invite_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `team_invite_codes_team_idx` ON `team_invite_codes` (`team_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `team_members` ADD `project_scope` text DEFAULT 'all' NOT NULL;