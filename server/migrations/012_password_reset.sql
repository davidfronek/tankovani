CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens (expires_at);

DELETE FROM password_reset_tokens WHERE expires_at <= NOW() OR used_at IS NOT NULL;