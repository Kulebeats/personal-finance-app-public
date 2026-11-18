CREATE TABLE IF NOT EXISTS calculation_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL UNIQUE,
  effective_date DATE NOT NULL,
  parameters JSONB NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  function_name VARCHAR(100) NOT NULL,
  inputs JSONB NOT NULL,
  output JSONB NOT NULL,
  parameter_version VARCHAR(20),
  execution_mode VARCHAR(20),
  execution_time_ms INTEGER,
  user_id UUID REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  channel VARCHAR(50),
  error_code VARCHAR(50),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_calc_logs_timestamp ON calculation_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_calc_logs_function ON calculation_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_calc_logs_household ON calculation_logs(household_id);
