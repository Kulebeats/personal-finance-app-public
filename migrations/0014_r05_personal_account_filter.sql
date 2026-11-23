ALTER TABLE "user_preferences" ADD COLUMN "default_account_filter" varchar(10) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "chk_user_preferences_default_account_filter" CHECK ("default_account_filter" IN ('all', 'mine', 'shared'));
