-- Add notification retention policy to households table
-- Part of P2 NOTIF-DATA-001: Add retention policy configuration

ALTER TABLE households
ADD COLUMN notification_retention_days INTEGER NOT NULL DEFAULT 90;

COMMENT ON COLUMN households.notification_retention_days IS 'Number of days to retain archived notifications before purging (default 90 days for compliance)';
