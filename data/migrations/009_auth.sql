-- Online auth: link dashboard users to Supabase Auth (optional — dev username login still works).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_auth_provider_id ON users (auth_provider_id)
  WHERE auth_provider_id IS NOT NULL;
