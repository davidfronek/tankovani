ALTER TABLE fuels ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE fuel_prices ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

DO $$
DECLARE
	only_user_id BIGINT;
BEGIN
	SELECT id INTO only_user_id
	FROM users
	ORDER BY id
	LIMIT 1;

	IF only_user_id IS NOT NULL AND (SELECT COUNT(*) FROM users) = 1 THEN
		UPDATE fuels SET user_id = only_user_id WHERE user_id IS NULL;
		UPDATE fuel_prices SET user_id = only_user_id WHERE user_id IS NULL;
		UPDATE refuel_logs SET user_id = only_user_id WHERE user_id IS NULL;
		UPDATE vehicles SET user_id = only_user_id WHERE user_id IS NULL;
	END IF;
END $$;

ALTER TABLE fuels DROP CONSTRAINT IF EXISTS fuels_station_fuel_name_key;
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fuels_user_station_fuel_name_key'
	) THEN
		ALTER TABLE fuels ADD CONSTRAINT fuels_user_station_fuel_name_key UNIQUE (user_id, station, fuel_name);
	END IF;
END $$;

ALTER TABLE refuel_logs DROP CONSTRAINT IF EXISTS refuel_logs_fuel_name_refuel_date_volume_l_total_price_key;
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'refuel_logs_user_fuel_date_volume_total_key'
	) THEN
		ALTER TABLE refuel_logs ADD CONSTRAINT refuel_logs_user_fuel_date_volume_total_key UNIQUE (user_id, fuel_name, refuel_date, volume_l, total_price);
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS fuels_user_id_idx ON fuels (user_id);
CREATE INDEX IF NOT EXISTS fuel_prices_user_id_idx ON fuel_prices (user_id);
CREATE INDEX IF NOT EXISTS refuel_logs_user_id_idx ON refuel_logs (user_id);
CREATE INDEX IF NOT EXISTS vehicles_user_id_idx ON vehicles (user_id);
CREATE INDEX IF NOT EXISTS fuel_prices_user_station_date_idx ON fuel_prices (user_id, station, price_date DESC);
CREATE INDEX IF NOT EXISTS refuel_logs_user_vehicle_idx ON refuel_logs (user_id, vehicle_id);
