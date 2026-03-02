CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`event` text NOT NULL,
	`properties` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `analytics_events_event_idx` ON `analytics_events` (`event`);--> statement-breakpoint
CREATE INDEX `analytics_events_created_at_idx` ON `analytics_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_user_idx` ON `analytics_events` (`user_id`);