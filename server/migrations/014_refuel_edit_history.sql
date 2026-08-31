ALTER TABLE refuel_logs
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS refuel_edit_history (
  id BIGSERIAL PRIMARY KEY,
  refuel_id BIGINT NOT NULL REFERENCES refuel_logs(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_data JSONB NOT NULL,
  new_data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS refuel_edit_history_refuel_id_changed_at_idx
  ON refuel_edit_history (refuel_id, changed_at DESC, id DESC);