-- Migration: Add recurring frequency options
-- Created: 2026-01-10
-- Description: Adds semi-annual and annual values to recurring_frequency enum

DO $$
BEGIN
  ALTER TYPE recurring_frequency ADD VALUE IF NOT EXISTS 'semi_annually';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE recurring_frequency ADD VALUE IF NOT EXISTS 'annually';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
