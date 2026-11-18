
-- Phase 0A: Incremental Migration
-- Run this to add new columns to existing database
-- This migration is safe to run on existing databases

-- Skip enum creation if they already exist (handled by IF NOT EXISTS in PostgreSQL 13+)
DO $$ 
BEGIN
    -- account_type enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
        CREATE TYPE account_type AS ENUM('checking', 'savings', 'credit', 'cash', 'mobile_money', 'investment', 'loan', 'real_estate', 'vehicle', 'other');
    END IF;
    
    -- transaction_type enum  
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE transaction_type AS ENUM('income', 'expense', 'transfer', 'balance_adjustment');
    END IF;
    
    -- transaction_source enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_source') THEN
        CREATE TYPE transaction_source AS ENUM('manual', 'whatsapp', 'receipt_scan', 'csv_import', 'recurring');
    END IF;
    
    -- transaction_status enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN
        CREATE TYPE transaction_status AS ENUM('pending', 'cleared', 'reconciled');
    END IF;
    
    -- recurring_frequency enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurring_frequency') THEN
        CREATE TYPE recurring_frequency AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');
    END IF;
    
    -- household_role enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'household_role') THEN
        CREATE TYPE household_role AS ENUM('owner', 'admin', 'member', 'view_only');
    END IF;
END $$;

-- ============================================================================
-- ACCOUNTS TABLE - Add new columns if they don't exist
-- ============================================================================

-- Add initial_balance column
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS initial_balance NUMERIC(15, 2) DEFAULT '0' NOT NULL;

-- Add is_private column
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false NOT NULL;

-- Add owner_user_id column
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================================
-- TRANSACTIONS TABLE - Add new columns if they don't exist
-- ============================================================================

-- Add is_transfer_in column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer_in BOOLEAN DEFAULT false;

-- Add is_balance_adjustment_increase column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_balance_adjustment_increase BOOLEAN DEFAULT true;

-- Add status column (we'll keep it as varchar since changing type requires data migration)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'cleared';

-- Add is_private column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false NOT NULL;

-- Add idempotency_key column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

-- Add source column (as varchar for compatibility)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';

-- ============================================================================
-- NEW TABLES - Create if they don't exist
-- ============================================================================

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Transaction Comments table
CREATE TABLE IF NOT EXISTS transaction_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- VERIFY
-- ============================================================================

-- List new columns
SELECT 'Migration complete. New columns and tables added.' AS status;
