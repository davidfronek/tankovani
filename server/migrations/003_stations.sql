CREATE TABLE IF NOT EXISTS stations (
  name TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate existing stations from fuels table
INSERT INTO stations (name)
SELECT DISTINCT station FROM fuels
ON CONFLICT (name) DO NOTHING;
