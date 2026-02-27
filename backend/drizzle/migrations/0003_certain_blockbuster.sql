ALTER TABLE `group_members` ADD `muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `bot_started` integer DEFAULT false NOT NULL;