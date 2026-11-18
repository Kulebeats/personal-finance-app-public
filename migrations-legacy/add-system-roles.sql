-- Migration: Add System Roles for RBAC
-- Created: 2026-01-10

-- Create system_role enum type
DO $$ BEGIN
    CREATE TYPE system_role AS ENUM ('super_admin', 'support', 'analyst', 'readonly_admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create system_roles table
CREATE TABLE IF NOT EXISTS system_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create user_system_roles junction table
CREATE TABLE IF NOT EXISTS user_system_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES system_roles(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_system_roles_user_id ON user_system_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_system_roles_role_id ON user_system_roles(role_id);

-- Seed default roles
INSERT INTO system_roles (name, description, permissions) VALUES
    ('super_admin', 'Full system access - can manage all users and settings', '["*"]'),
    ('support', 'Customer support - can view user data with limited write access', '["users.read", "logs.read", "households.read"]'),
    ('analyst', 'Data analyst - read-only access to system metrics and reports', '["metrics.read", "logs.read", "reports.read"]'),
    ('readonly_admin', 'Read-only admin - can view admin dashboard but not modify anything', '["admin.read"]')
ON CONFLICT (name) DO NOTHING;
