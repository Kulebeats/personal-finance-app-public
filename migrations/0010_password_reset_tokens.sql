-- Idempotent so this migration can be applied to a database whose objects were
-- already created by `drizzle-kit push` (the local dev path). Without the
-- guards a push-built DB fails here with `relation "password_reset_tokens"
-- already exists`, which aborts the whole `db:migrate` run and leaves every
-- later migration unapplied. Same pattern as 0009.
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_ip" text
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'password_reset_tokens_user_id_fk'
      AND conrelid = 'password_reset_tokens'::regclass
  ) THEN
    ALTER TABLE "password_reset_tokens"
      ADD CONSTRAINT "password_reset_tokens_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_user_id" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_password_reset_tokens_token_hash" ON "password_reset_tokens" USING btree ("token_hash");
