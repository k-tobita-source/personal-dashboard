CREATE TABLE `sync_state` (
	`source` text PRIMARY KEY NOT NULL,
	`last_synced_at` integer
);
