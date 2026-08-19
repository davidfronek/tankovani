ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS receipt_path TEXT;
ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS receipt_original_name TEXT;
ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS receipt_mime_type TEXT;
ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS receipt_size INTEGER;