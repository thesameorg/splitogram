ALTER TABLE `expenses` ADD `split_mode` text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `receipt_key` text;--> statement-breakpoint
ALTER TABLE `settlements` ADD `receipt_thumb_key` text;