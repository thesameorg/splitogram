DROP INDEX `groups_invite_code_unique`;--> statement-breakpoint
DROP INDEX `users_telegram_id_unique`;--> statement-breakpoint
ALTER TABLE `settlements` ADD `comment` text;--> statement-breakpoint
ALTER TABLE `settlements` ADD `settled_by` integer REFERENCES users(id);