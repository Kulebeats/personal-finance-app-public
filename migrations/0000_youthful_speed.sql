CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit', 'cash', 'mobile_money', 'investment', 'loan', 'mortgage', 'other_liability', 'real_estate', 'vehicle', 'other');--> statement-breakpoint
CREATE TYPE "public"."assignment_type_enum" AS ENUM('full_balance', 'partial_balance');--> statement-breakpoint
CREATE TYPE "public"."goal_progress_source" AS ENUM('contributions', 'holdings');--> statement-breakpoint
CREATE TYPE "public"."goal_status_enum" AS ENUM('on_track', 'behind', 'at_risk', 'completed');--> statement-breakpoint
CREATE TYPE "public"."goal_type_enum" AS ENUM('save_up', 'pay_down', 'investment');--> statement-breakpoint
CREATE TYPE "public"."grz_bond_payment_status" AS ENUM('scheduled', 'paid', 'missed');--> statement-breakpoint
CREATE TYPE "public"."grz_security_status" AS ENUM('active', 'matured', 'sold', 'rolled_over');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('owner', 'admin', 'member', 'view_only', 'professional');--> statement-breakpoint
CREATE TYPE "public"."investment_notification_type" AS ENUM('maturity_reminder', 'coupon_payment', 'auction_results', 'price_alert', 'nav_update', 'goal_milestone', 'recurring_execution', 'stale_price');--> statement-breakpoint
CREATE TYPE "public"."investment_transaction_type" AS ENUM('buy', 'sell', 'dividend', 'interest', 'fee', 'split', 'transfer_in', 'transfer_out', 'coupon', 'maturity');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."link_type_enum" AS ENUM('contribution', 'spending');--> statement-breakpoint
CREATE TYPE "public"."outbox_event_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."payoff_method_enum" AS ENUM('avalanche', 'snowball', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annually', 'annually', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."security_exchange" AS ENUM('luse', 'nyse', 'nasdaq', 'jse', 'otc', 'boz', 'manual');--> statement-breakpoint
CREATE TYPE "public"."security_type" AS ENUM('stock', 'bond', 'etf', 'mutual_fund', 'unit_trust', 'term_deposit', 'tbill', 'forex', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('super_admin', 'support', 'analyst', 'readonly_admin');--> statement-breakpoint
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
	"apr" numeric(5, 2),
	"statement_day" integer,
	"estimated_value" numeric(15, 2),
	"purchase_date" date,
	"address" text,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"is_asset" boolean DEFAULT true NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"owner_user_id" uuid,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"exclude_from_net_worth" boolean DEFAULT false NOT NULL,
	"hide_transactions" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "benchmark_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric(15, 4) NOT NULL,
	"source" varchar(50),
	"created_at" timestamp DEFAULT now()
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
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
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
	"is_flex_bucket" boolean DEFAULT false NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
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
	"rollover_enabled" boolean DEFAULT false,
	"rollover_start_balance" numeric(15, 2),
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
	"budget_mode" varchar(20) DEFAULT 'by_category' NOT NULL,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "csd_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"csd_account_number" varchar(50) NOT NULL,
	"account_holder_name" varchar(255),
	"settlement_bank" varchar(100),
	"settlement_account" varchar(50),
	"is_verified" boolean DEFAULT false,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "currency_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0',
	"current_balance" numeric(15, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"household_id" uuid,
	"export_type" varchar(50) NOT NULL,
	"file_format" varchar(10) NOT NULL,
	"file_url" text,
	"date_range_start" date,
	"date_range_end" date,
	"record_count" integer,
	"parameters" jsonb,
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
CREATE TABLE "filter_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"context" varchar(50) NOT NULL,
	"filters" jsonb NOT NULL,
	"is_default" boolean DEFAULT false,
	"is_shared" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" varchar(3) NOT NULL,
	"to_currency" varchar(3) NOT NULL,
	"rate" numeric(10, 4) NOT NULL,
	"date" date NOT NULL,
	"source" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goal_account_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"assignment_type" "assignment_type_enum" NOT NULL,
	"partial_amount" numeric(15, 2),
	"auto_update" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"activity_type" varchar(50) NOT NULL,
	"amount" numeric(15, 2),
	"previous_balance" numeric(15, 2),
	"new_balance" numeric(15, 2),
	"metadata" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "goal_image_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"stored_filename" varchar(255) NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_goal_id" uuid NOT NULL,
	"to_goal_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"reason" text,
	"created_by" uuid,
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
	"custom_image_url" text,
	"created_by" uuid,
	"target_amount" numeric(15, 2) NOT NULL,
	"current_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"target_date" date,
	"start_date" date DEFAULT now() NOT NULL,
	"projected_completion_date" date,
	"monthly_projection" numeric(15, 2),
	"expected_return" numeric(5, 2),
	"inflation_rate" numeric(5, 2),
	"linked_account_id" uuid,
	"progress_source" "goal_progress_source" DEFAULT 'contributions' NOT NULL,
	"type" "goal_type_enum" DEFAULT 'save_up' NOT NULL,
	"goal_type" varchar(50),
	"status" "goal_status_enum" DEFAULT 'on_track' NOT NULL,
	"spending_reduces_progress" boolean DEFAULT false NOT NULL,
	"debt_account_id" uuid,
	"original_balance" numeric(15, 2),
	"interest_rate" numeric(5, 2),
	"minimum_payment" numeric(15, 2),
	"monthly_payment" numeric(15, 2),
	"one_time_payment" numeric(15, 2),
	"payoff_method" "payoff_method_enum",
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grz_auction_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_date" date NOT NULL,
	"security_type" varchar(20) NOT NULL,
	"tenor" varchar(20) NOT NULL,
	"amount_offered" numeric(15, 2),
	"amount_accepted" numeric(15, 2),
	"weighted_avg_yield" numeric(6, 4),
	"highest_yield" numeric(6, 4),
	"lowest_yield" numeric(6, 4),
	"weighted_avg_discount" numeric(6, 4),
	"source" varchar(50) DEFAULT 'BOZ',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "grz_bond_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bond_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"payment_type" varchar(20) NOT NULL,
	"gross_amount" numeric(15, 2) NOT NULL,
	"withholding_tax" numeric(15, 2) DEFAULT '0',
	"net_amount" numeric(15, 2) NOT NULL,
	"status" "grz_bond_payment_status" DEFAULT 'scheduled',
	"actual_payment_date" date,
	"investment_transaction_id" uuid,
	"income_transaction_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "grz_bonds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"isin" varchar(20),
	"bond_name" varchar(100) NOT NULL,
	"tenor_years" integer NOT NULL,
	"face_value" numeric(15, 2) NOT NULL,
	"purchase_price" numeric(15, 2) NOT NULL,
	"purchase_date" date NOT NULL,
	"purchase_yield" numeric(6, 4),
	"acquisition_type" varchar(20) DEFAULT 'PRIMARY',
	"coupon_rate" numeric(6, 4) NOT NULL,
	"coupon_frequency" integer DEFAULT 2,
	"first_coupon_date" date,
	"maturity_date" date NOT NULL,
	"csd_account_number" varchar(50),
	"csd_reference" varchar(50),
	"status" "grz_security_status" DEFAULT 'active',
	"sold_date" date,
	"sold_price" numeric(15, 2),
	"sold_yield" numeric(6, 4),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "grz_tbills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"isin" varchar(20),
	"tbill_name" varchar(100) NOT NULL,
	"tenor_days" integer NOT NULL,
	"face_value" numeric(15, 2) NOT NULL,
	"purchase_price" numeric(15, 2) NOT NULL,
	"purchase_date" date NOT NULL,
	"purchase_yield" numeric(6, 4),
	"discount_amount" numeric(15, 2),
	"maturity_date" date NOT NULL,
	"csd_account_number" varchar(50),
	"status" "grz_security_status" DEFAULT 'active',
	"matured_date" date,
	"rollover_to_id" uuid,
	"maturity_investment_tx_id" uuid,
	"maturity_income_tx_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"cost_basis" numeric(15, 2),
	"cost_basis_zmw" numeric(15, 2),
	"acquired_date" date,
	"acquisition_fx_rate" numeric(10, 4),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "household_role" DEFAULT 'member' NOT NULL,
	"invite_code" varchar(64) NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_by" uuid,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "household_invitations_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"role" "household_role" NOT NULL,
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
	"budget_system" varchar(20) DEFAULT 'flex',
	"show_pending_transactions" boolean DEFAULT true,
	"allow_edit_pending" boolean DEFAULT true,
	"display_merchant_logos" boolean DEFAULT true,
	"default_budget_scope" varchar(20) DEFAULT 'current_month',
	"budget_warning_threshold" integer DEFAULT 75,
	"budget_danger_threshold" integer DEFAULT 90,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW',
	"fiscal_year_start_month" integer DEFAULT 1,
	"notification_retention_days" integer DEFAULT 90 NOT NULL,
	"ai_consent_given" boolean DEFAULT false,
	"ai_consent_date" timestamp,
	"ai_consent_version" varchar(10) DEFAULT 'v1.0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"holding_id" uuid,
	"security_id" uuid,
	"type" "investment_transaction_type" NOT NULL,
	"quantity" numeric(18, 8),
	"price" numeric(15, 4),
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"fx_rate" numeric(10, 4),
	"amount_zmw" numeric(15, 2),
	"fees" numeric(15, 2) DEFAULT '0',
	"withholding_tax" numeric(15, 2) DEFAULT '0',
	"linked_transaction_id" uuid,
	"transaction_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"payload" jsonb,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"idempotency_key" varchar(255),
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
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
CREATE TABLE "merchant_logo_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"stored_filename" varchar(255) NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "merchant_merge_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_merchant_id" uuid NOT NULL,
	"source_merchant_name" varchar(255) NOT NULL,
	"target_merchant_id" uuid NOT NULL,
	"merged_transaction_ids" jsonb,
	"merged_by" uuid,
	"merged_at" timestamp DEFAULT now(),
	"can_undo" boolean DEFAULT true,
	"undo_expires_at" timestamp DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(255) NOT NULL,
	"logo_url" text,
	"category" varchar(100),
	"default_category_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"icon_type" varchar(20) DEFAULT 'logo',
	"custom_icon" text,
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
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"action_url" varchar(255),
	"metadata" jsonb,
	"dedupe_key" varchar(150),
	"is_read" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"household_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "outbox_event_status" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"thumbnail_path" varchar(500),
	"ocr_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ocr_data" jsonb,
	"ocr_confidence" numeric(5, 2),
	"ocr_processed_at" timestamp,
	"ocr_error_message" text,
	"match_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"matched_transaction_id" uuid,
	"match_attempts" integer DEFAULT 0 NOT NULL,
	"last_match_attempt" timestamp,
	"next_match_at" timestamp,
	"idempotency_key" varchar(255),
	"image_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pending_receipts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "pension_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pension_holding_id" uuid NOT NULL,
	"date" date NOT NULL,
	"employee_contribution" numeric(15, 2) NOT NULL,
	"employer_contribution" numeric(15, 2) NOT NULL,
	"total_contribution" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pension_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"provider_name" varchar(255) NOT NULL,
	"account_number" varchar(100),
	"pension_type" varchar(50) NOT NULL,
	"current_balance" numeric(15, 2) DEFAULT '0',
	"projected_retirement_date" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portfolio_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"currency" varchar(3),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"alert_type" varchar(20) NOT NULL,
	"threshold" numeric(15, 4) NOT NULL,
	"is_active" boolean DEFAULT true,
	"last_triggered" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_investment_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"execution_date" timestamp DEFAULT now() NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"result_entity_id" uuid,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid,
	"type" varchar(50) NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"next_execution_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_transaction_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_transaction_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"previous_state" jsonb,
	"new_state" jsonb,
	"change_reason" text,
	"performed_by" uuid,
	"linked_transaction_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_transaction_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_transaction_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"match_confidence" integer,
	"match_method" varchar(20) DEFAULT 'manual',
	"expected_date" date,
	"actual_date" date,
	"expected_amount" numeric(15, 2),
	"actual_amount" numeric(15, 2),
	"status" varchar(20) DEFAULT 'linked',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"amount_type" varchar(10) DEFAULT 'fixed',
	"amount_tolerance" integer DEFAULT 0,
	"type" "transaction_type" NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"frequency" "recurring_frequency" NOT NULL,
	"interval_value" integer DEFAULT 1,
	"interval_unit" varchar(10),
	"start_date" date NOT NULL,
	"end_date" date,
	"next_due_date" date NOT NULL,
	"day_of_month" integer,
	"day_of_week" integer,
	"total_occurrences" integer DEFAULT 0,
	"missed_count" integer DEFAULT 0,
	"last_occurred_date" date,
	"detection_method" varchar(20) DEFAULT 'manual',
	"detection_confidence" integer,
	"reminder_days" integer DEFAULT 3,
	"reminder_email" boolean DEFAULT false,
	"reminder_push" boolean DEFAULT false,
	"reminder_in_app" boolean DEFAULT true,
	"auto_link_enabled" boolean DEFAULT true,
	"auto_mark_reviewed" boolean DEFAULT false,
	"is_subscription" boolean DEFAULT false,
	"trial_end_date" date,
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
	"condition_logic" varchar(10) DEFAULT 'all' NOT NULL,
	"actions" jsonb NOT NULL,
	"split_config" jsonb,
	"apply_to_past" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "security_type" NOT NULL,
	"currency" varchar(3) DEFAULT 'ZMW' NOT NULL,
	"exchange" "security_exchange",
	"is_offshore" boolean DEFAULT false,
	"sector" varchar(100),
	"cusip_isin" varchar(20),
	"current_price" numeric(15, 4),
	"last_price_update" timestamp,
	"withholding_tax_rate" numeric(5, 2) DEFAULT '15.00',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"user_id" uuid,
	"target_user_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price" numeric(15, 4) NOT NULL,
	"source" varchar(50),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "system_roles_name_unique" UNIQUE("name")
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
	"is_archived" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_lot_disposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"tax_lot_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"proceeds" numeric(15, 2) NOT NULL,
	"proceeds_zmw" numeric(15, 2),
	"cost_basis" numeric(15, 2) NOT NULL,
	"cost_basis_zmw" numeric(15, 2),
	"realized_gain" numeric(15, 2) NOT NULL,
	"realized_gain_zmw" numeric(15, 2),
	"disposed_date" date NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"transaction_id" uuid,
	"quantity" numeric(18, 8) NOT NULL,
	"cost_basis" numeric(15, 2) NOT NULL,
	"cost_basis_zmw" numeric(15, 2),
	"acquired_date" date NOT NULL,
	"acquisition_fx_rate" numeric(10, 4),
	"remaining_quantity" numeric(18, 8) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"thumbnail_path" varchar(500),
	"ocr_status" varchar(20) DEFAULT 'none',
	"ocr_data" jsonb,
	"ocr_confidence" numeric(5, 2),
	"ocr_processed_at" timestamp,
	"ocr_error_message" text,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "transaction_goal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"link_type" "link_type_enum" DEFAULT 'contribution' NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"linked_by" uuid
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
	"currency" varchar(3),
	"type" "transaction_type" NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"transfer_account_id" uuid,
	"transfer_transaction_id" uuid,
	"is_transfer_in" boolean DEFAULT false,
	"fx_rate" numeric(18, 8),
	"fx_base_currency" varchar(3),
	"fx_quote_currency" varchar(3),
	"fx_timestamp" timestamp,
	"fx_source" varchar(50),
	"converted_amount" numeric(15, 2),
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
CREATE TABLE "user_ai_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"allow_data_training" boolean DEFAULT true,
	"ai_insights_enabled" boolean DEFAULT true,
	"ai_category_suggestions" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_display_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'system',
	"currency" varchar(3) DEFAULT 'ZMW',
	"locale" varchar(10) DEFAULT 'en-US',
	"timezone" varchar(100) DEFAULT 'Africa/Lusaka',
	"number_format" varchar(20) DEFAULT 'US',
	"date_format" varchar(20) DEFAULT 'MM/DD/YYYY',
	"currency_position" varchar(10) DEFAULT 'before',
	"first_day_of_week" varchar(10) DEFAULT 'Sunday',
	"view_mode" varchar(20) DEFAULT 'comfortable',
	"dashboard_widgets" jsonb,
	"report_widget_preferences" jsonb,
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
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"remember_last_account" boolean DEFAULT true,
	"remember_last_category_per_merchant" boolean DEFAULT true,
	"default_transaction_type" varchar(20) DEFAULT 'expense',
	"auto_fill_today_date" boolean DEFAULT true,
	"skip_duplicate_imports" boolean DEFAULT true,
	"auto_assign_categories_from_rules" boolean DEFAULT true,
	"auto_create_from_receipt" boolean DEFAULT false,
	"require_ocr_review" boolean DEFAULT true,
	"ocr_confidence_threshold" integer DEFAULT 70,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
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
CREATE TABLE "user_system_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp DEFAULT now()
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
	"email_verified" boolean DEFAULT false,
	"email_verification_token" text,
	"email_verification_expiry" timestamp,
	"pending_email" varchar(255),
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
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp,
	"last_failed_login_at" timestamp,
	"mfa_enabled" boolean DEFAULT false,
	"mfa_method" varchar(20),
	"mfa_code" text,
	"mfa_code_expiry" timestamp,
	"mfa_backup_codes" jsonb,
	"mfa_backup_codes_generated_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_values" ADD CONSTRAINT "benchmark_values_benchmark_id_portfolio_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."portfolio_benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_group_id_category_groups_id_fk" FOREIGN KEY ("category_group_id") REFERENCES "public"."category_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csd_accounts" ADD CONSTRAINT "csd_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_accounts" ADD CONSTRAINT "currency_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_account_assignments" ADD CONSTRAINT "goal_account_assignments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_account_assignments" ADD CONSTRAINT "goal_account_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_activity_log" ADD CONSTRAINT "goal_activity_log_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_activity_log" ADD CONSTRAINT "goal_activity_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_image_uploads" ADD CONSTRAINT "goal_image_uploads_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_image_uploads" ADD CONSTRAINT "goal_image_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "goal_transfers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "goal_transfers_from_goal_id_goals_id_fk" FOREIGN KEY ("from_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "goal_transfers_to_goal_id_goals_id_fk" FOREIGN KEY ("to_goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "goal_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_debt_account_id_accounts_id_fk" FOREIGN KEY ("debt_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_payments" ADD CONSTRAINT "grz_bond_payments_bond_id_grz_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."grz_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_payments" ADD CONSTRAINT "grz_bond_payments_investment_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("investment_transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_payments" ADD CONSTRAINT "grz_bond_payments_income_transaction_id_transactions_id_fk" FOREIGN KEY ("income_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bonds" ADD CONSTRAINT "grz_bonds_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bonds" ADD CONSTRAINT "grz_bonds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "grz_tbills_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "grz_tbills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "grz_tbills_maturity_investment_tx_id_investment_transactions_id_fk" FOREIGN KEY ("maturity_investment_tx_id") REFERENCES "public"."investment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "grz_tbills_maturity_income_tx_id_transactions_id_fk" FOREIGN KEY ("maturity_income_tx_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_logo_uploads" ADD CONSTRAINT "merchant_logo_uploads_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_logo_uploads" ADD CONSTRAINT "merchant_logo_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_merge_history" ADD CONSTRAINT "merchant_merge_history_target_merchant_id_merchants_id_fk" FOREIGN KEY ("target_merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_merge_history" ADD CONSTRAINT "merchant_merge_history_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_receipts" ADD CONSTRAINT "pending_receipts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_receipts" ADD CONSTRAINT "pending_receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_receipts" ADD CONSTRAINT "pending_receipts_matched_transaction_id_transactions_id_fk" FOREIGN KEY ("matched_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_contributions" ADD CONSTRAINT "pension_contributions_pension_holding_id_pension_holdings_id_fk" FOREIGN KEY ("pension_holding_id") REFERENCES "public"."pension_holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_holdings" ADD CONSTRAINT "pension_holdings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_holdings" ADD CONSTRAINT "pension_holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_execution_log" ADD CONSTRAINT "recurring_execution_log_recurring_investment_id_recurring_investments_id_fk" FOREIGN KEY ("recurring_investment_id") REFERENCES "public"."recurring_investments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_investments" ADD CONSTRAINT "recurring_investments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_investments" ADD CONSTRAINT "recurring_investments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_investments" ADD CONSTRAINT "recurring_investments_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transaction_history" ADD CONSTRAINT "recurring_transaction_history_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transaction_history" ADD CONSTRAINT "recurring_transaction_history_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transaction_history" ADD CONSTRAINT "recurring_transaction_history_linked_transaction_id_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transaction_links" ADD CONSTRAINT "recurring_transaction_links_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transaction_links" ADD CONSTRAINT "recurring_transaction_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_execution_log" ADD CONSTRAINT "rule_execution_log_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_prices" ADD CONSTRAINT "security_prices_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lot_disposals" ADD CONSTRAINT "tax_lot_disposals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lot_disposals" ADD CONSTRAINT "tax_lot_disposals_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lot_disposals" ADD CONSTRAINT "tax_lot_disposals_tax_lot_id_tax_lots_id_fk" FOREIGN KEY ("tax_lot_id") REFERENCES "public"."tax_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lot_disposals" ADD CONSTRAINT "tax_lot_disposals_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_comments" ADD CONSTRAINT "transaction_comments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_comments" ADD CONSTRAINT "transaction_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_goal_links" ADD CONSTRAINT "transaction_goal_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_goal_links" ADD CONSTRAINT "transaction_goal_links_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_goal_links" ADD CONSTRAINT "transaction_goal_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "user_ai_preferences" ADD CONSTRAINT "user_ai_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_display_settings" ADD CONSTRAINT "user_display_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login_history" ADD CONSTRAINT "user_login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_push_subscriptions" ADD CONSTRAINT "user_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quiet_hours" ADD CONSTRAINT "user_quiet_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factor_auth" ADD CONSTRAINT "user_two_factor_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_goal_account_idx" ON "goal_account_assignments" USING btree ("goal_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_auction_result_idx" ON "grz_auction_results" USING btree ("auction_date","security_type","tenor");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_role" ON "user_system_roles" USING btree ("user_id","role_id");