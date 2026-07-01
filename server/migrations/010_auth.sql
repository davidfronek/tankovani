CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM sessions WHERE expires_at <= NOW();
DELETE FROM oauth_states WHERE expires_at <= NOW();
