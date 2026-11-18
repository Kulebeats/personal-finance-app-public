CREATE TABLE IF NOT EXISTS price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  security_id uuid NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  alert_type varchar(20) NOT NULL,
  threshold decimal(15, 4) NOT NULL,
  is_active boolean DEFAULT true,
  last_triggered timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
