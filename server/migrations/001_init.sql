CREATE TABLE IF NOT EXISTS fuel_prices (
  id BIGSERIAL PRIMARY KEY,
  station TEXT NOT NULL,
  fuel_name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  price_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_prices DROP CONSTRAINT IF EXISTS fuel_prices_station_fuel_name_price_date_key;

CREATE TABLE IF NOT EXISTS fuels (
  id BIGSERIAL PRIMARY KEY,
  station TEXT NOT NULL,
  fuel_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (station, fuel_name)
);

CREATE TABLE IF NOT EXISTS refuel_logs (
  id BIGSERIAL PRIMARY KEY,
  fuel_name TEXT NOT NULL,
  refuel_date DATE NOT NULL,
  mileage_km NUMERIC(10,1),
  volume_l NUMERIC(10,3) NOT NULL,
  price_per_l NUMERIC(10,2) NOT NULL,
  discounted_price_per_l NUMERIC(10,2),
  total_price NUMERIC(10,2) NOT NULL,
  discounted_total_price NUMERIC(10,2),
  savings NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fuel_name, refuel_date, volume_l, total_price)
);

ALTER TABLE refuel_logs ADD COLUMN IF NOT EXISTS mileage_km NUMERIC(10,1);

CREATE TABLE IF NOT EXISTS vehicle_profile (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  car_type TEXT NOT NULL DEFAULT '',
  tank_capacity_l NUMERIC(6,2),
  current_fuel_l NUMERIC(6,2),
  avg_consumption_l100 NUMERIC(6,2),
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vehicle_profile ADD COLUMN IF NOT EXISTS current_fuel_l NUMERIC(6,2);

INSERT INTO vehicle_profile (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vehicles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Moje auto',
  car_type TEXT NOT NULL DEFAULT '',
  tank_capacity_l NUMERIC(6,2),
  current_fuel_l NUMERIC(6,2),
  avg_consumption_l100 NUMERIC(6,2),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles LIMIT 1) THEN
    INSERT INTO vehicles (name, car_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, note)
    SELECT 'Moje auto', car_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, note
    FROM vehicle_profile
    WHERE car_type != '' OR tank_capacity_l IS NOT NULL OR avg_consumption_l100 IS NOT NULL;
  END IF;
END $$;
