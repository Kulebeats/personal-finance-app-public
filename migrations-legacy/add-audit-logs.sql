-- Migration: Add Security Audit Logs Table
-- Created: 2026-01-10

CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    user_id UUID,
    target_user_id UUID,
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type ON security_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_id ON security_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_combined ON security_audit_logs(event_type, created_at DESC);
