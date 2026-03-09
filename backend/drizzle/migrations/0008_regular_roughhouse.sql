CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`base` text DEFAULT 'USD' NOT NULL,
	`rates` text NOT NULL,
	`fetched_at` integer NOT NULL
);
