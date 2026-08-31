import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pkg from "pg";

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/tanko";

export const pool = new Pool({ connectionString });

export async function runInitMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/001_init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runStationsMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/003_stations.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runVehicleIdMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/004_vehicle_id.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runFuelTypeMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/005_vehicle_fuel_type.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runFuelFuelTypeMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/006_fuel_fuel_type.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runRefuelStationMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/007_refuel_station.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runRefuelFullFillMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/008_refuel_full_fill.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runVehicleInitialKmMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/009_vehicle_initial_km.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runAuthMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/010_auth.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runUserDataScopeMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/011_user_data_scope.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runPasswordResetMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/012_password_reset.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runRefuelReceiptMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/013_refuel_receipt.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runRefuelEditHistoryMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/014_refuel_edit_history.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runUserAdminMigration() {
  const sqlPath = path.resolve(__dirname, "../migrations/015_user_admin.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}

export async function runSqlFile(relativePathFromServerRoot) {
  const sqlPath = path.resolve(__dirname, "..", relativePathFromServerRoot);
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}
