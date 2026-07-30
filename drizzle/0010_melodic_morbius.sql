CREATE TABLE `ork_change_proposal_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`component_name` text NOT NULL,
	`component_kind` text NOT NULL,
	`change_type` text NOT NULL,
	`geometry_changed` integer DEFAULT false NOT NULL,
	`changes_json` text NOT NULL,
	`rationale` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ork_change_proposal_items_proposal_idx` ON `ork_change_proposal_items` (`proposal_id`,`id`);--> statement-breakpoint
CREATE INDEX `ork_change_proposal_items_component_idx` ON `ork_change_proposal_items` (`project_id`,`component_id`);--> statement-breakpoint
CREATE TABLE `ork_change_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`source_name` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`changed_components` integer NOT NULL,
	`geometry_changes` integer DEFAULT 0 NOT NULL,
	`submitted_by_name` text NOT NULL,
	`submitted_by_email` text NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_by_name` text,
	`reviewed_by_email` text,
	`reviewed_at` text,
	`review_notes` text,
	`applied_version` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ork_change_proposals_object_key_unique` ON `ork_change_proposals` (`object_key`);--> statement-breakpoint
CREATE INDEX `ork_change_proposals_project_idx` ON `ork_change_proposals` (`project_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `ork_change_proposals_status_idx` ON `ork_change_proposals` (`project_id`,`status`);