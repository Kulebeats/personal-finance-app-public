-- R10.3 (FIN-09, NEW-29): goal progress sources keep their provenance and the
-- signed change they actually applied, so unlink, source edit and source delete
-- restore the exact prior progress, and a mistaken contribution is reversed by
-- an audited correction row instead of being deleted.
-- Additive only: existing rows keep NULL provenance (no backfill).
ALTER TABLE public.transaction_goal_links
  ADD COLUMN amount_basis varchar(16),
  ADD COLUMN source_amount numeric(15, 2),
  ADD COLUMN source_currency varchar(3),
  ADD COLUMN fx_rate numeric(20, 10),
  ADD COLUMN applied_delta numeric(15, 2);
--> statement-breakpoint
ALTER TABLE public.goal_contributions
  ADD COLUMN kind varchar(16) DEFAULT 'contribution' NOT NULL,
  ADD COLUMN corrects_contribution_id uuid,
  ADD COLUMN applied_delta numeric(15, 2),
  ADD COLUMN created_by uuid;
--> statement-breakpoint
ALTER TABLE public.goal_contributions
  ADD CONSTRAINT goal_contributions_corrects_fk
    FOREIGN KEY (corrects_contribution_id) REFERENCES public.goal_contributions (id) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.goal_contributions
  ADD CONSTRAINT goal_contributions_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.goal_contributions
  ADD CONSTRAINT chk_goal_contributions_kind CHECK (kind IN ('contribution', 'correction'));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_goal_contributions_corrects
  ON public.goal_contributions USING btree (corrects_contribution_id)
  WHERE corrects_contribution_id IS NOT NULL;
