-- Add professional role to household_role enum
ALTER TYPE household_role ADD VALUE IF NOT EXISTS 'professional';
