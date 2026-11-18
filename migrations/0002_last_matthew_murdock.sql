CREATE INDEX "idx_account_balance_snapshots_account_date" ON "account_balance_snapshots" USING btree ("account_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_accounts_household" ON "accounts" USING btree ("household_id","display_order") WHERE deleted_at IS NULL AND is_archived = FALSE;--> statement-breakpoint
CREATE INDEX "idx_accounts_household_asset" ON "accounts" USING btree ("household_id","is_asset") WHERE deleted_at IS NULL AND is_hidden = FALSE;--> statement-breakpoint
CREATE INDEX "idx_accounts_type_household" ON "accounts" USING btree ("household_id","type") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_household_created" ON "audit_logs" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_budget_periods_budget_date" ON "budget_periods" USING btree ("budget_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_budget_periods_lookup" ON "budget_periods" USING btree ("budget_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_budget_periods_budget_date_range" ON "budget_periods" USING btree ("budget_id","start_date","end_date") WHERE budget_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_budget_periods_budget_id" ON "budget_periods" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "idx_budget_periods_covering" ON "budget_periods" USING btree ("budget_id","start_date","end_date","budget_amount","spent_amount","rollover_in","version");--> statement-breakpoint
CREATE INDEX "idx_budget_periods_date_range" ON "budget_periods" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_budget_id_start_date_end_date_unique" ON "budget_periods" USING btree ("budget_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_budgets_household_active" ON "budgets" USING btree ("household_id") WHERE is_active = TRUE;--> statement-breakpoint
CREATE INDEX "idx_budgets_household_active_status" ON "budgets" USING btree ("household_id","is_active") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_budgets_category_id" ON "budgets" USING btree ("category_id") WHERE category_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_budgets_category_group_id" ON "budgets" USING btree ("category_group_id") WHERE category_group_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_budgets_flex_bucket" ON "budgets" USING btree ("household_id","is_flex_bucket") WHERE is_flex_bucket = true;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_budgets_flex_unique" ON "budgets" USING btree ("household_id") WHERE is_flex_bucket = true;--> statement-breakpoint
CREATE INDEX "idx_categories_group" ON "categories" USING btree ("group_id","display_order") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_data_exports_household_id" ON "data_exports" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_data_exports_user_household" ON "data_exports" USING btree ("user_id","household_id");--> statement-breakpoint
CREATE INDEX "idx_goal_account_assignments_goal" ON "goal_account_assignments" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "idx_goal_account_assignments_account" ON "goal_account_assignments" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goal_account_full_balance" ON "goal_account_assignments" USING btree ("account_id") WHERE assignment_type = 'full_balance';--> statement-breakpoint
CREATE INDEX "idx_goal_activity_goal" ON "goal_activity_log" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "idx_goal_activity_date" ON "goal_activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_goal_contributions_goal_date" ON "goal_contributions" USING btree ("goal_id","date");--> statement-breakpoint
CREATE INDEX "idx_goal_image_uploads_household" ON "goal_image_uploads" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_goal_transfers_household" ON "goal_transfers" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_goal_transfers_from" ON "goal_transfers" USING btree ("from_goal_id");--> statement-breakpoint
CREATE INDEX "idx_goal_transfers_to" ON "goal_transfers" USING btree ("to_goal_id");--> statement-breakpoint
CREATE INDEX "idx_goal_transfers_date" ON "goal_transfers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_goals_type" ON "goals" USING btree ("household_id","type");--> statement-breakpoint
CREATE INDEX "idx_goals_status" ON "goals" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "idx_goals_debt_account" ON "goals" USING btree ("debt_account_id") WHERE debt_account_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_grz_bonds_household" ON "grz_bonds" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_grz_tbills_household" ON "grz_tbills" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_holdings_household" ON "holdings" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_holdings_account" ON "holdings" USING btree ("account_id") WHERE account_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_household_invitations_code" ON "household_invitations" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "idx_household_invitations_household_pending" ON "household_invitations" USING btree ("household_id","accepted_at") WHERE accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_household_invitations_email" ON "household_invitations" USING btree ("email","household_id") WHERE accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_household_members_user" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_household_members_household" ON "household_members" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_investment_transactions_household_date" ON "investment_transactions" USING btree ("household_id","transaction_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_investment_transactions_holding" ON "investment_transactions" USING btree ("holding_id","transaction_date" DESC NULLS LAST) WHERE holding_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_merchant_logo_uploads_merchant" ON "merchant_logo_uploads" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "idx_merchant_merge_history_target" ON "merchant_merge_history" USING btree ("target_merchant_id");--> statement-breakpoint
CREATE INDEX "idx_merchant_merge_history_can_undo" ON "merchant_merge_history" USING btree ("can_undo","undo_expires_at");--> statement-breakpoint
CREATE INDEX "idx_merchants_category" ON "merchants" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_merchants_default_category" ON "merchants" USING btree ("default_category_id");--> statement-breakpoint
CREATE INDEX "idx_merchants_household_active" ON "merchants" USING btree ("household_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_net_worth_snapshots_household_date" ON "net_worth_snapshots" USING btree ("household_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pending_receipts_household_idx" ON "pending_receipts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "pending_receipts_match_status_idx" ON "pending_receipts" USING btree ("match_status","next_match_at");--> statement-breakpoint
CREATE INDEX "pending_receipts_idempotency_idx" ON "pending_receipts" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pending_receipts_image_hash_idx" ON "pending_receipts" USING btree ("household_id","image_hash") WHERE image_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_recurring_history_recurring" ON "recurring_transaction_history" USING btree ("recurring_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_history_created" ON "recurring_transaction_history" USING btree ("recurring_transaction_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_recurring_links_transaction" ON "recurring_transaction_links" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_links_recurring" ON "recurring_transaction_links" USING btree ("recurring_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recurring_link_transaction_recurring" ON "recurring_transaction_links" USING btree ("transaction_id","recurring_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_security_audit_logs_event_type" ON "security_audit_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_security_audit_logs_user_id" ON "security_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_security_audit_logs_created_at" ON "security_audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_security_audit_logs_combined" ON "security_audit_logs" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_security_prices_security_date" ON "security_prices" USING btree ("security_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_security_prices_security_date" ON "security_prices" USING btree ("security_id","date");--> statement-breakpoint
CREATE INDEX "idx_tax_lots_holding" ON "tax_lots" USING btree ("holding_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_attachments_transaction_id" ON "transaction_attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_attachments_created_at" ON "transaction_attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transaction_attachments_ocr_status_idx" ON "transaction_attachments" USING btree ("ocr_status") WHERE ocr_status != 'none';--> statement-breakpoint
CREATE INDEX "idx_transaction_goal_links_transaction" ON "transaction_goal_links" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_goal_links_goal" ON "transaction_goal_links" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transaction_goal" ON "transaction_goal_links" USING btree ("transaction_id","goal_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_splits_transaction" ON "transaction_splits" USING btree ("transaction_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_transaction_splits_category" ON "transaction_splits" USING btree ("category_id","transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_tags_transaction" ON "transaction_tags" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transaction_tags_tag" ON "transaction_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_household_date" ON "transactions" USING btree ("household_id","date" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_household_type_date" ON "transactions" USING btree ("household_id","type","date" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_category_date" ON "transactions" USING btree ("category_id","date" DESC NULLS LAST) WHERE deleted_at IS NULL AND is_excluded_from_reports = FALSE;--> statement-breakpoint
CREATE INDEX "idx_transactions_merchant_date" ON "transactions" USING btree ("merchant_id","date" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_account_date" ON "transactions" USING btree ("account_id","date" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_owner_date" ON "transactions" USING btree ("owner_user_id","date" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_pending" ON "transactions" USING btree ("household_id","is_pending") WHERE deleted_at IS NULL AND is_pending = TRUE;--> statement-breakpoint
CREATE INDEX "idx_transactions_cursor" ON "transactions" USING btree ("date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_currency" ON "transactions" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "idx_transactions_account_type_date" ON "transactions" USING btree ("account_id","date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_transactions_category_month" ON "transactions" USING btree ("category_id","date") WHERE deleted_at IS NULL AND type = 'expense';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_transactions_transfer_pair" ON "transactions" USING btree ("household_id","transfer_transaction_id","is_transfer_in") WHERE deleted_at IS NULL AND type = 'transfer';--> statement-breakpoint
CREATE INDEX "idx_user_display_settings_report_widgets" ON "user_display_settings" USING gin ("report_widget_preferences");--> statement-breakpoint
CREATE INDEX "idx_user_push_subscriptions_user_id" ON "user_push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_push_subscriptions_endpoint" ON "user_push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "idx_user_system_roles_user_id" ON "user_system_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_system_roles_role_id" ON "user_system_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_users_locked_until" ON "users" USING btree ("locked_until") WHERE locked_until IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_backup_codes_expiry" ON "users" USING btree ("mfa_backup_codes_generated_at") WHERE mfa_enabled = true AND mfa_backup_codes IS NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "chk_account_currency_length" CHECK (currency IS NULL OR LENGTH(currency) = 3);--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "chk_budget_amount_positive" CHECK (CAST(amount AS DECIMAL) >= 0);--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "chk_budget_warning_threshold" CHECK (warning_threshold IS NULL OR (warning_threshold >= 0 AND warning_threshold <= 100));--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "chk_budget_alert_threshold" CHECK (alert_threshold IS NULL OR (alert_threshold >= 0 AND alert_threshold <= 200));--> statement-breakpoint
ALTER TABLE "goal_account_assignments" ADD CONSTRAINT "chk_partial_no_auto" CHECK (assignment_type = 'full_balance' OR auto_update = FALSE);--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "chk_different_goals" CHECK (from_goal_id != to_goal_id);--> statement-breakpoint
ALTER TABLE "goal_transfers" ADD CONSTRAINT "chk_positive_amount" CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "chk_goal_target_positive" CHECK (CAST(target_amount AS DECIMAL) > 0);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "chk_goal_current_nonnegative" CHECK (CAST(current_amount AS DECIMAL) >= 0);--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "chk_household_currency_length" CHECK (currency IS NULL OR LENGTH(currency) = 3);--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "chk_recurring_amount_positive" CHECK (CAST(amount AS DECIMAL) > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transaction_amount_nonzero" CHECK (type = 'balance_adjustment' OR ABS(CAST(amount AS DECIMAL)) > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transaction_currency_length" CHECK (currency IS NULL OR LENGTH(currency) = 3);