CREATE TABLE `flight_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`flight_date` text,
	`computer` text DEFAULT 'CATS Vega' NOT NULL,
	`source_file_name` text NOT NULL,
	`source_format` text DEFAULT 'CSV' NOT NULL,
	`launch_site_name` text DEFAULT '' NOT NULL,
	`launch_latitude` real NOT NULL,
	`launch_longitude` real NOT NULL,
	`launch_altitude` real NOT NULL,
	`heading_degrees` real DEFAULT 0 NOT NULL,
	`ork_version` integer,
	`raw_object_key` text NOT NULL,
	`processed_object_key` text NOT NULL,
	`source_size_bytes` integer DEFAULT 0 NOT NULL,
	`processed_size_bytes` integer DEFAULT 0 NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`duration` real DEFAULT 0 NOT NULL,
	`max_altitude` real DEFAULT 0 NOT NULL,
	`max_velocity` real,
	`max_acceleration` real,
	`max_distance` real DEFAULT 0 NOT NULL,
	`landing_distance` real DEFAULT 0 NOT NULL,
	`has_gps` integer DEFAULT false NOT NULL,
	`mapping_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`imported_by_name` text NOT NULL,
	`imported_by_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flight_records_raw_object_key_unique` ON `flight_records` (`raw_object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `flight_records_processed_object_key_unique` ON `flight_records` (`processed_object_key`);--> statement-breakpoint
CREATE INDEX `flight_records_project_idx` ON `flight_records` (`project_id`,`created_at`);