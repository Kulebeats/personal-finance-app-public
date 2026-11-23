-- ISOLATED CANDIDATE: coordinator creates this before principal settlements in
-- the common, staged 0025. No journal edit or legacy basis backfill is implied.
CREATE TABLE grz_bond_principal_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial NOT NULL,
  household_id uuid NOT NULL REFERENCES households(id), bond_id uuid NOT NULL REFERENCES grz_bonds(id),
  account_id uuid NOT NULL REFERENCES accounts(id), recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  operation_id uuid NOT NULL, intent_hash varchar(64) NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  authority varchar(30) NOT NULL, isin varchar(20) NOT NULL, nominal_amount numeric(15,2) NOT NULL,
  currency varchar(3) NOT NULL, acquisition_date date NOT NULL, source_date date NOT NULL,
  source_kind varchar(30) NOT NULL, source_reference text NOT NULL, purchase_cash_amount numeric(15,2) NOT NULL,
  principal_cost numeric(15,2) NOT NULL, purchased_interest numeric(15,2) NOT NULL, acquisition_fees numeric(15,2) NOT NULL,
  policy_version varchar(64) NOT NULL,
  CONSTRAINT chk_grz_principal_basis_terms CHECK (authority='member_recorded' AND currency='ZMW'
    AND source_date>=acquisition_date AND source_kind IN ('custodian_statement','trade_confirmation','contract_note')
    AND source_reference ~ '[^[:space:]]'
    AND principal_cost>0 AND purchased_interest>=0 AND acquisition_fees>=0 AND nominal_amount>0
    AND purchase_cash_amount=principal_cost+purchased_interest+acquisition_fees
    AND principal_cost::text ~ '^[0-9]+([.][0-9]+)?$' AND purchased_interest::text ~ '^[0-9]+([.][0-9]+)?$'
    AND acquisition_fees::text ~ '^[0-9]+([.][0-9]+)?$' AND purchase_cash_amount::text ~ '^[0-9]+([.][0-9]+)?$'
    AND nominal_amount::text ~ '^[0-9]+([.][0-9]+)?$')
);
CREATE UNIQUE INDEX uq_grz_basis_household_operation ON grz_bond_principal_basis(household_id,operation_id);
CREATE INDEX idx_grz_basis_bond_sequence ON grz_bond_principal_basis(bond_id,sequence);
CREATE FUNCTION public.guard_grz_principal_basis_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Principal basis evidence is append-only' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END
$body$;
CREATE TRIGGER grz_principal_basis_update_guard BEFORE UPDATE ON grz_bond_principal_basis
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_update();
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_update() FROM PUBLIC;

CREATE FUNCTION public.guard_grz_principal_basis_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  PERFORM 1 FROM public.households WHERE id=NEW.household_id FOR SHARE;
  IF NOT FOUND OR NEW.recorded_by IS NULL THEN
    RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.household_members WHERE household_id=NEW.household_id AND user_id=NEW.recorded_by
    AND role::text IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514'; END IF;
  -- Match the service order: household -> grant -> bond -> custody -> user.
  -- Foreign-key key-share alone does not fence a concurrent non-key change
  -- to holding status, account privacy, denomination or asset classification.
  PERFORM 1 FROM public.grz_bonds WHERE id=NEW.bond_id AND household_id=NEW.household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.accounts WHERE id=NEW.account_id AND household_id=NEW.household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.users WHERE id=NEW.recorded_by AND erased_at IS NULL AND email_verified=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514'; END IF;
  IF NEW.source_date>(transaction_timestamp() at time zone 'UTC')::date OR NEW.policy_version<>'grz_member_recorded_principal_basis_v1' THEN
    RAISE EXCEPTION 'Principal basis requires a supported dated source' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.grz_bonds b JOIN public.accounts a ON a.id=b.account_id
    WHERE b.id=NEW.bond_id AND b.household_id=NEW.household_id AND a.id=NEW.account_id AND a.household_id=NEW.household_id
      AND b.status::text='active' AND b.isin=NEW.isin AND b.face_value=NEW.nominal_amount AND b.purchase_date=NEW.acquisition_date
      AND b.purchase_price=NEW.purchase_cash_amount AND a.currency='ZMW' AND a.is_asset=true AND a.deleted_at IS NULL
      AND (a.is_private=false OR a.owner_user_id=NEW.recorded_by);
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END
$body$;
CREATE TRIGGER grz_principal_basis_insert_guard BEFORE INSERT ON grz_bond_principal_basis
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_insert();
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_insert() FROM PUBLIC;

CREATE FUNCTION public.guard_grz_principal_basis_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id) THEN
    RAISE EXCEPTION 'Principal basis history requires whole-household erasure' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
CREATE CONSTRAINT TRIGGER grz_principal_basis_delete_guard AFTER DELETE ON grz_bond_principal_basis
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_delete();
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_delete() FROM PUBLIC;

CREATE FUNCTION public.guard_grz_principal_basis_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  RAISE EXCEPTION 'Principal basis history cannot be truncated' USING ERRCODE='23514';
END
$body$;
CREATE TRIGGER grz_principal_basis_truncate_guard BEFORE TRUNCATE ON grz_bond_principal_basis
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_grz_principal_basis_truncate();
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_truncate() FROM PUBLIC;
