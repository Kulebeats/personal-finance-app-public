CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit', 'cash', 'mobile_money', 'investment', 'loan', 'real_estate', 'vehicle', 'other');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('owner', 'admin', 'member', 'view_only');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'whatsapp', 'receipt_scan', 'csv_import', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'cleared', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense', 'transfer', 'balance_adjustment');--> statement-breakpoint
CREATE TABLE "account_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"balance" numeric(15, 2) NOT NULL,
	"available_balance" numeric(15, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "account_type" NOT NULL,
	"subtype" varchar(50),
	"institution" varchar(255),
	"institution_logo" text,
	"balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"available_balance" numeric(15, 2),
	"initial_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credit_limit" numeric(15, 2),
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"is_asset" boolean DEFAULT true NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"owner_user_id" uuid,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"color" varchar(7),
	"icon" varchar(50),
	"display_order" integer DEFAULT 0 NOT NULL,
	"external_id" varchar(255),
	"external_source" varchar(50),
	"last_synced_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"details" jsonb,
	"ip_address" "inet",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"budget_amount" numeric(15, 2) NOT NULL,
	"spent_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"rollover_in" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category_id" uuid,
	"category_group_id" uuid,
	"amount" numeric(15, 2) NOT NULL,
	"period" varchar(20) DEFAULT 'monthly' NOT NULL,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"rollover_amount" numeric(15, 2) DEFAULT '0',
	"warning_threshold" integer DEFAULT 80,
	"alert_threshold" integer DEFAULT 100,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"group_id" uuid,
	"name" varchar(100) NOT NULL,
	"icon" varchar(50),
	"color" varchar(7),
	"include_in_budget" boolean DEFAULT true,
	"is_archived" boolean DEFAULT false,
	"display_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "category_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"export_type" varchar(50) NOT NULL,
	"file_format" varchar(10) NOT NULL,
	"file_url" text,
	"date_range_start" date,
	"date_range_end" date,
	"record_count" integer,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"file_size" integer,
	"record_count" integer,
	"successful_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending',
	"error_log" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"transaction_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"icon" varchar(50),
	"color" varchar(7),
	"target_amount" numeric(15, 2) NOT NULL,
	"current_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"target_date" date,
	"start_date" date DEFAULT now() NOT NULL,
	"linked_account_id" uuid,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) NOT NULL,
	"invitation_token" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "household_invitations_invitation_token_unique" UNIQUE("invitation_token")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"role" varchar(20) NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	"last_active_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "household_preferences" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"default_month_only_changes" boolean DEFAULT true,
	"auto_rollover_budget" boolean DEFAULT false,
	"rollover_percentage" integer DEFAULT 100,
	"auto_mark_reviewed" boolean DEFAULT false,
	"review_threshold_amount" numeric(15, 2),
	"show_pending_transactions" boolean DEFAULT true,
	"allow_edit_pending" boolean DEFAULT true,
	"display_merchant_logos" boolean DEFAULT true,
	"default_budget_scope" varchar(20) DEFAULT 'current_month',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW',
	"fiscal_year_start_month" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid,
	"alias_name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(255) NOT NULL,
	"logo_url" text,
	"transaction_count" integer DEFAULT 0,
	"last_transaction_date" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_assets" numeric(15, 2) NOT NULL,
	"total_liabilities" numeric(15, 2) NOT NULL,
	"net_worth" numeric(15, 2) NOT NULL,
	"assets_by_type" jsonb,
	"liabilities_by_type" jsonb,
	"account_balances" jsonb,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"type" "transaction_type" NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"frequency" "recurring_frequency" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_due_date" date NOT NULL,
	"day_of_month" integer,
	"day_of_week" integer,
	"reminder_days" integer DEFAULT 3,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"transaction_id" uuid,
	"executed_at" timestamp DEFAULT now(),
	"success" boolean NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true,
	"priority" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"apply_to_past" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(50) NOT NULL,
	"color" varchar(7),
	"icon" varchar(50),
	"member_specific" boolean DEFAULT false,
	"member_id" uuid,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"notes" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"original_name" varchar(255),
	"amount" numeric(15, 2) NOT NULL,
	"type" "transaction_type" NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"transfer_account_id" uuid,
	"transfer_transaction_id" uuid,
	"is_transfer_in" boolean DEFAULT false,
	"is_balance_adjustment_increase" boolean DEFAULT true,
	"is_pending" boolean DEFAULT false NOT NULL,
	"status" "transaction_status" DEFAULT 'cleared',
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurring_transaction_id" uuid,
	"is_excluded_from_reports" boolean DEFAULT false NOT NULL,
	"is_excluded_from_budget" boolean DEFAULT false NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"idempotency_key" uuid,
	"source" "transaction_source" DEFAULT 'manual',
	"reviewed_at" timestamp,
	"reviewed_by" uuid,
	"notes" text,
	"external_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "user_display_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'system',
	"currency" varchar(3) DEFAULT 'ZMW',
	"locale" varchar(10) DEFAULT 'en-US',
	"timezone" varchar(50) DEFAULT 'Africa/Lusaka',
	"number_format" varchar(20) DEFAULT 'US',
	"date_format" varchar(20) DEFAULT 'MM/DD/YYYY',
	"currency_position" varchar(10) DEFAULT 'before',
	"first_day_of_week" varchar(10) DEFAULT 'Sunday',
	"view_mode" varchar(20) DEFAULT 'comfortable',
	"dashboard_widgets" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_login_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"login_time" timestamp DEFAULT now(),
	"device_name" varchar(255),
	"ip_address" "inet",
	"location" varchar(255),
	"success" boolean NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"notification_type" varchar(50) NOT NULL,
	"in_app_enabled" boolean DEFAULT true,
	"email_enabled" boolean DEFAULT true,
	"push_enabled" boolean DEFAULT false,
	"threshold_amount" numeric(15, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_quiet_hours" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_token" text NOT NULL,
	"device_name" varchar(255),
	"device_type" varchar(50),
	"browser" varchar(100),
	"os" varchar(100),
	"ip_address" "inet",
	"location" varchar(255),
	"is_trusted" boolean DEFAULT false,
	"last_active_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "user_two_factor_auth" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false,
	"method" varchar(20),
	"secret" text,
	"backup_codes" text[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(100),
	"first_name" varchar(50),
	"last_name" varchar(50),
	"display_name" varchar(100),
	"birthday" date,
	"birthday_hide_year" boolean DEFAULT false,
	"gender" varchar(50),
	"phone_number" text,
	"phone_number_mobile" text,
	"phone_number_work" text,
	"phone_number_home" text,
	"address" jsonb,
	"occupation" varchar(100),
	"occupation_custom" boolean DEFAULT false,
	"company" varchar(255),
	"timezone" varchar(50) DEFAULT 'UTC',
	"profile_picture_url" text,
	"banner_url" text,
	"bio" text,
	"social_links" jsonb,
	"nrc" varchar(20),
	"annual_income" numeric(15, 2),
	"income_frequency" varchar(20),
	"employment_status" varchar(50),
	"investment_goal" varchar(50),
	"risk_tolerance" varchar(50),
	"salary_range_encrypted" text,
	"profile_completeness" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_group_id_category_groups_id_fk" FOREIGN KEY ("category_group_id") REFERENCES "public"."category_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_execution_log" ADD CONSTRAINT "rule_execution_log_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_comments" ADD CONSTRAINT "transaction_comments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_comments" ADD CONSTRAINT "transaction_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_display_settings" ADD CONSTRAINT "user_display_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login_history" ADD CONSTRAINT "user_login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quiet_hours" ADD CONSTRAINT "user_quiet_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factor_auth" ADD CONSTRAINT "user_two_factor_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;