CREATE TABLE `studio_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`asset_id` integer NOT NULL,
	`title` text NOT NULL,
	`file_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`feedback` text DEFAULT '[]' NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
