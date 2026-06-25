CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`lane` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`sender` text,
	`url` text,
	`external_id` text,
	`start_at` integer,
	`end_at` integer,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_source_external_id_unq` ON `task` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `task_lane_position_idx` ON `task` (`lane`,`position`);--> statement-breakpoint
CREATE INDEX `task_start_at_idx` ON `task` (`start_at`);