ALTER TABLE `group_members` ADD `net_balance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `activity_log_group_created_idx` ON `activity_log` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_idx` ON `activity_log` (`actor_id`);