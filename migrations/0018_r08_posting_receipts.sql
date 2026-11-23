ALTER TABLE "transactions" ADD COLUMN "posted_balance_delta" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "posted_account_is_asset" boolean;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "posting_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transaction_posting_receipt" CHECK ((
    (posting_mode IS NULL AND posted_account_is_asset IS NULL AND posted_balance_delta IS NULL)
    OR (posting_mode IS NOT NULL AND posted_account_is_asset IS NOT NULL AND posted_balance_delta IS NOT NULL
      AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$'
      AND posted_balance_delta::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND (posting_mode = 'posted' OR (posting_mode = 'history_only' AND posted_balance_delta = 0)))
  ));