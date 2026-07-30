CREATE TABLE `component_mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`component_id` text NOT NULL,
	`component_code` text NOT NULL,
	`comment_id` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_email` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`body_excerpt` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `component_mentions_comment_recipient_unique` ON `component_mentions` (`comment_id`,`recipient_email`);--> statement-breakpoint
CREATE INDEX `component_mentions_recipient_idx` ON `component_mentions` (`project_id`,`recipient_email`,`read_at`,`id`);