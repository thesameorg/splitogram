CREATE TABLE `expense_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`text` text,
	`image_key` text,
	`image_thumb_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_comments_expense_idx` ON `expense_comments` (`expense_id`);--> statement-breakpoint
CREATE INDEX `expense_comments_expense_created_idx` ON `expense_comments` (`expense_id`,`created_at`);