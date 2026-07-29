CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`ork_version` integer NOT NULL,
	`ork_sha256` text NOT NULL,
	`simulation_index` integer NOT NULL,
	`simulation_name` text NOT NULL,
	`engine` text NOT NULL,
	`engine_version` text NOT NULL,
	`result_object_key` text NOT NULL,
	`max_altitude` real,
	`max_velocity` real,
	`max_acceleration` real,
	`max_mach` real,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`run_by_name` text NOT NULL,
	`run_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `simulation_runs_result_object_key_unique` ON `simulation_runs` (`result_object_key`);--> statement-breakpoint
CREATE INDEX `simulation_runs_project_idx` ON `simulation_runs` (`project_id`,`created_at`);