-- NEW-39: give the 14 foreign keys whose generated names exceed Postgres's 63-byte identifier
-- limit explicit short names. Postgres stored each one truncated to 63 bytes, so rename from
-- that truncated name. RENAME CONSTRAINT changes only the catalog: no table scan, no
-- revalidation, and the delete/update rules stay as they are. A constraint already carrying
-- the new name is skipped; one with neither name is refused rather than left missing.
-- Each rename takes ACCESS EXCLUSIVE briefly: fail fast behind a long reader rather than
-- queue traffic behind the migration.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('grz_bond_payments', 'grz_bond_payments_investment_transaction_id_investment_transactions_id_fk', 'grz_bond_payments_investment_transaction_id_fk'),
    ('grz_tbills', 'grz_tbills_maturity_investment_tx_id_investment_transactions_id_fk', 'grz_tbills_maturity_investment_tx_id_fk'),
    ('investment_transactions', 'investment_transactions_linked_transaction_id_transactions_id_fk', 'investment_transactions_linked_transaction_id_fk'),
    ('recurring_execution_log', 'recurring_execution_log_recurring_investment_id_recurring_investments_id_fk', 'recurring_execution_log_recurring_investment_id_fk'),
    ('recurring_transaction_history', 'recurring_transaction_history_recurring_transaction_id_recurring_transactions_id_fk', 'recurring_transaction_history_recurring_transaction_id_fk'),
    ('recurring_transaction_history', 'recurring_transaction_history_linked_transaction_id_transactions_id_fk', 'recurring_transaction_history_linked_transaction_id_fk'),
    ('recurring_transaction_links', 'recurring_transaction_links_recurring_transaction_id_recurring_transactions_id_fk', 'recurring_transaction_links_recurring_transaction_id_fk'),
    ('transaction_create_owner_intents', 'transaction_create_owner_intents_transaction_id_transactions_id_fk', 'transaction_create_owner_intents_transaction_id_fk'),
    ('transaction_create_owner_intents', 'transaction_create_owner_intents_transfer_inflow_id_transactions_id_fk', 'transaction_create_owner_intents_transfer_inflow_id_fk'),
    ('grz_principal_settlements', 'grz_principal_settlements_requested_receipt_id_transactions_id_fk', 'grz_principal_settlements_requested_receipt_id_fk'),
    ('grz_principal_settlements', 'grz_principal_settlements_cash_transaction_id_transactions_id_fk', 'grz_principal_settlements_cash_transaction_id_fk'),
    ('grz_principal_settlements', 'grz_principal_settlements_investment_transaction_id_investment_transactions_id_fk', 'grz_principal_settlements_investment_transaction_id_fk'),
    ('grz_principal_settlements', 'grz_principal_settlements_basis_id_grz_bond_principal_basis_id_fk', 'grz_principal_settlements_basis_id_fk'),
    ('grz_principal_settlements', 'grz_principal_settlements_valuation_id_grz_bond_valuations_id_fk', 'grz_principal_settlements_valuation_id_fk')
  ) AS v(table_name, old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
               WHERE t.relnamespace = 'public'::regnamespace AND t.relname = r.table_name
                 AND c.contype = 'f' AND c.conname = left(r.old_name, 63)) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.table_name, left(r.old_name, 63), r.new_name);
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
               WHERE t.relnamespace = 'public'::regnamespace AND t.relname = r.table_name
                 AND c.contype = 'f' AND c.conname = r.new_name) THEN
      RAISE EXCEPTION 'NEW-39: foreign key % on % has neither its old nor its new name', r.new_name, r.table_name;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Drizzle applies every pending migration in one transaction: restore the default for later ones.
SET LOCAL lock_timeout TO DEFAULT;
