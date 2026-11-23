-- ISOLATED CANDIDATE ONLY. Coordinator composes reserved append-only 0025 after
-- 0024, with the principal-settlement fragment. No journal changes or backfill.
CREATE TABLE grz_bond_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial NOT NULL,
  household_id uuid NOT NULL REFERENCES households(id),
  bond_id uuid NOT NULL REFERENCES grz_bonds(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  operation_id uuid NOT NULL,
  intent_hash varchar(64) NOT NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  authority varchar(30) NOT NULL,
  isin varchar(20) NOT NULL,
  nominal_amount numeric(15,2) NOT NULL,
  currency varchar(3) NOT NULL,
  valuation_date date NOT NULL,
  source_date date NOT NULL,
  source_kind varchar(30) NOT NULL,
  source_reference text NOT NULL,
  quote_basis varchar(10) NOT NULL,
  quote_units varchar(30) NOT NULL,
  quoted_amount numeric(23,8) NOT NULL,
  accrued_quote numeric(23,8),
  clean_value numeric(15,2),
  dirty_value numeric(15,2) NOT NULL,
  accrued_value numeric(15,2),
  coupon_state jsonb NOT NULL,
  policy_version varchar(60) NOT NULL,
  CONSTRAINT ck_grz_valuation_authority CHECK (authority='member_recorded'),
  CONSTRAINT ck_grz_valuation_currency CHECK (currency='ZMW'),
  CONSTRAINT ck_grz_valuation_source_date CHECK (source_date=valuation_date),
  CONSTRAINT ck_grz_valuation_source CHECK (source_kind IN ('custodian_statement','same_issue_quote','same_issue_trade') AND length(trim(source_reference))>0),
  CONSTRAINT ck_grz_valuation_quote CHECK (quote_basis IN ('clean','dirty') AND quote_units IN ('holding_amount','per_100_nominal')
    AND nominal_amount>0 AND nominal_amount::text ~ '^[0-9]+([.][0-9]+)?$'
    AND quoted_amount>0 AND quoted_amount::text ~ '^[0-9]+([.][0-9]+)?$'
    AND (accrued_quote IS NULL OR (accrued_quote>=0 AND accrued_quote::text ~ '^[0-9]+([.][0-9]+)?$'))),
  CONSTRAINT ck_grz_valuation_components CHECK (dirty_value>=0 AND dirty_value::text ~ '^[0-9]+([.][0-9]+)?$' AND
    ((clean_value IS NULL AND accrued_value IS NULL) OR
     (clean_value IS NOT NULL AND accrued_value IS NOT NULL AND clean_value>=0 AND accrued_value>=0
      AND clean_value::text ~ '^[0-9]+([.][0-9]+)?$' AND accrued_value::text ~ '^[0-9]+([.][0-9]+)?$'
      AND clean_value+accrued_value=dirty_value)))
);
CREATE UNIQUE INDEX uq_grz_valuation_household_operation ON grz_bond_valuations(household_id,operation_id);
CREATE INDEX idx_grz_valuation_bond_date_sequence ON grz_bond_valuations(bond_id,valuation_date,sequence);
