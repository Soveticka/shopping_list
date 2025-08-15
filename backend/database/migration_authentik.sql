-- Migration: Add Authentik OIDC integration support
-- Date: 2025-08-14
-- Description: Adds columns to support dual authentication (local + Authentik)

-- Add Authentik integration columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS authentik_sub VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_oidc_login TIMESTAMP NULL;

-- Add constraint to ensure valid auth_provider values
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS chk_auth_provider 
    CHECK (auth_provider IN ('local', 'authentik', 'both'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_authentik_sub ON users(authentik_sub);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);

-- Add comments for documentation
COMMENT ON COLUMN users.authentik_sub IS 'Authentik subject identifier from OIDC token';
COMMENT ON COLUMN users.auth_provider IS 'Authentication method: local, authentik, or both';
COMMENT ON COLUMN users.linked_at IS 'Timestamp when Authentik account was linked';
COMMENT ON COLUMN users.last_oidc_login IS 'Last successful OIDC authentication timestamp';

-- Allow password_hash to be NULL for Authentik-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT chk_password_or_authentik 
    CHECK (
        (auth_provider = 'authentik' AND password_hash IS NULL) OR
        (auth_provider = 'local' AND password_hash IS NOT NULL) OR
        (auth_provider = 'both' AND password_hash IS NOT NULL)
    );

-- Create audit table for authentication events (optional but recommended)
CREATE TABLE IF NOT EXISTS auth_audit (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    auth_method VARCHAR(20) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'login', 'account_link', 'account_unlink'
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user_id ON auth_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at ON auth_audit(created_at);

-- Update existing users to ensure they have valid auth_provider
UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL;