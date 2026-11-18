-- Migration: Update household_members.role to use enum
-- This migration changes the role column from varchar to household_role enum
-- NOTE: Run this ONLY if the enum doesn't exist yet or data is compatible

-- First, check if enum exists (it should from schema setup)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'household_role') THEN
        CREATE TYPE household_role AS ENUM ('owner', 'admin', 'member', 'view_only');
    END IF;
END $$;

-- Alter the column type (safe if existing values match enum)
ALTER TABLE household_members 
ALTER COLUMN role TYPE household_role 
USING role::household_role;
