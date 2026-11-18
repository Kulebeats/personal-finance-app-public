CREATE TABLE IF NOT EXISTS tax_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  holding_id uuid NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES investment_transactions(id) ON DELETE SET NULL,
  quantity decimal(18, 8) NOT NULL,
  cost_basis decimal(15, 2) NOT NULL,
  cost_basis_zmw decimal(15, 2),
  acquired_date date NOT NULL,
  acquisition_fx_rate decimal(10, 4),
  remaining_quantity decimal(18, 8) NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_lot_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  holding_id uuid NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  tax_lot_id uuid NOT NULL REFERENCES tax_lots(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,
  quantity decimal(18, 8) NOT NULL,
  proceeds decimal(15, 2) NOT NULL,
  proceeds_zmw decimal(15, 2),
  cost_basis decimal(15, 2) NOT NULL,
  cost_basis_zmw decimal(15, 2),
  realized_gain decimal(15, 2) NOT NULL,
  realized_gain_zmw decimal(15, 2),
  disposed_date date NOT NULL,
  created_at timestamp DEFAULT now()
);
