-- Add new personal information fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);

-- Add new financial profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS annual_income DECIMAL(15,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS income_frequency VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_status VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS investment_goal VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_tolerance VARCHAR(50);

-- Add new display settings fields to user_display_settings table
ALTER TABLE user_display_settings ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en-US';
ALTER TABLE user_display_settings ADD COLUMN IF NOT EXISTS currency_position VARCHAR(10) DEFAULT 'before';
ALTER TABLE user_display_settings ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB;
