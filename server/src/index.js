import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { pool, runInitMigration, runStationsMigration, runVehicleIdMigration, runFuelTypeMigration, runFuelFuelTypeMigration, runRefuelStationMigration, runRefuelFullFillMigration, runVehicleInitialKmMigration, runAuthMigration, runUserDataScopeMigration, runPasswordResetMigration, runRefuelReceiptMigration } from "./db.js";
import { installAuthRoutes, requireAuth } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const app = express();
app.set("trust proxy", 1);
const receiptUploadDirectory = path.resolve(__dirname, "../uploads/receipts");
fs.mkdirSync(receiptUploadDirectory, { recursive: true });
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Povolené jsou pouze soubory PDF, PNG, JPG a WebP."));
      return;
    }
    callback(null, true);
  },
});
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json());

installAuthRoutes(app);

async function ensureFuelExists(userId, station, fuelName) {
  await pool.query(
    `
    INSERT INTO fuels (user_id, station, fuel_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, station, fuel_name) DO NOTHING
    `,
    [userId, station, fuelName],
  );
}

async function findApplicableDiscountedPrice(userId, station, fuelName, refuelDate) {
  const params = [userId, fuelName, refuelDate];
  const stationClause = station ? `AND station = $4` : "";
  if (station) {
    params.push(station);
  }

  const result = await pool.query(
    `
    SELECT price
    FROM fuel_prices
    WHERE user_id = $1
      AND fuel_name = $2
      AND price_date <= $3
      ${stationClause}
    ORDER BY price_date DESC, id DESC
    LIMIT 1
    `,
    params,
  );

  if (result.rowCount === 0) {
    return null;
  }

  return Number(result.rows[0].price);
}

async function removeReceiptFile(receiptPath) {
  if (!receiptPath) {
    return;
  }

  const filePath = path.join(receiptUploadDirectory, path.basename(receiptPath));
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Odstranění účtenky selhalo: ${error.message}`);
    }
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as now");
    res.json({ ok: true, dbTime: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api", requireAuth);

app.get("/api/refuels", async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      id,
      station,
      fuel_name,
      TO_CHAR(refuel_date, 'YYYY-MM-DD') AS refuel_date,
      mileage_km,
      volume_l,
      price_per_l,
      discounted_price_per_l,
      total_price,
      discounted_total_price,
      savings,
      full_fill,
      receipt_original_name,
      receipt_mime_type,
      receipt_size
    FROM refuel_logs
    WHERE user_id = $1
    ORDER BY refuel_date DESC, id DESC
    `,
    [req.user.id],
  );

  res.json(result.rows);
});

app.post("/api/refuels", receiptUpload.single("receipt"), async (req, res) => {
  const station = String(req.body?.station ?? "").trim().toUpperCase();
  const fuelName = String(req.body?.fuel_name ?? "").trim();
  const refuelDate = String(req.body?.refuel_date ?? "").trim();
  const mileageInput = req.body?.mileage_km;
  const mileageKm = mileageInput === "" || mileageInput == null ? null : Number(mileageInput);
  const volumeL = Number(req.body?.volume_l);
  const pricePerL = Number(req.body?.price_per_l);
  const fullFill = req.body?.full_fill === true || req.body?.full_fill === "true";
  const vehicleIdInput = req.body?.vehicle_id;
  const vehicleId = vehicleIdInput == null || vehicleIdInput === "" ? null : Number(vehicleIdInput);

  if (!fuelName) {
    return res.status(400).json({ ok: false, error: "Fuel name is required." });
  }

  if (!refuelDate || Number.isNaN(new Date(refuelDate).getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid refuel date." });
  }

  if (!Number.isFinite(volumeL) || volumeL <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid volume." });
  }

  if (!Number.isFinite(pricePerL) || pricePerL <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid price per liter." });
  }

  if (mileageKm != null && (!Number.isFinite(mileageKm) || mileageKm < 0)) {
    return res.status(400).json({ ok: false, error: "Invalid mileage." });
  }

  if (vehicleId != null && (!Number.isInteger(vehicleId) || vehicleId <= 0)) {
    return res.status(400).json({ ok: false, error: "Invalid vehicle id." });
  }

  if (vehicleId != null) {
    const vehicleResult = await pool.query(
      `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2`,
      [vehicleId, req.user.id],
    );
    if (vehicleResult.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "Invalid vehicle id." });
    }
  }

  const configuredDiscountedPricePerL = await findApplicableDiscountedPrice(req.user.id, station, fuelName, refuelDate);
  const effectiveDiscountedPricePerL = configuredDiscountedPricePerL == null
    ? null
    : Math.min(pricePerL, configuredDiscountedPricePerL);

  const totalPrice = Number((volumeL * pricePerL).toFixed(2));
  const discountedTotalPrice = effectiveDiscountedPricePerL == null ? null : Number((volumeL * effectiveDiscountedPricePerL).toFixed(2));
  const savings = discountedTotalPrice == null ? null : Number((totalPrice - discountedTotalPrice).toFixed(2));
  const existingReceiptResult = req.file
    ? await pool.query(
      `SELECT receipt_path FROM refuel_logs WHERE user_id = $1 AND fuel_name = $2 AND refuel_date = $3 AND volume_l = $4 AND total_price = $5`,
      [req.user.id, fuelName, refuelDate, volumeL, totalPrice],
    )
    : { rows: [] };
  const receiptFilename = req.file
    ? crypto.randomUUID()
    : null;
  if (req.file) {
    await fs.promises.writeFile(path.join(receiptUploadDirectory, receiptFilename), req.file.buffer);
  }

  let result;
  try {
    result = await pool.query(
    `
    INSERT INTO refuel_logs (
      user_id,
      station,
      fuel_name,
      refuel_date,
      mileage_km,
      volume_l,
      price_per_l,
      discounted_price_per_l,
      total_price,
      discounted_total_price,
      savings,
      full_fill,
      receipt_path,
      receipt_original_name,
      receipt_mime_type,
      receipt_size,
      vehicle_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (user_id, fuel_name, refuel_date, volume_l, total_price)
    DO UPDATE SET
      station = COALESCE(EXCLUDED.station, refuel_logs.station),
      mileage_km = EXCLUDED.mileage_km,
      discounted_price_per_l = EXCLUDED.discounted_price_per_l,
      discounted_total_price = EXCLUDED.discounted_total_price,
      savings = EXCLUDED.savings,
      full_fill = EXCLUDED.full_fill,
      vehicle_id = COALESCE(EXCLUDED.vehicle_id, refuel_logs.vehicle_id),
      receipt_path = COALESCE(EXCLUDED.receipt_path, refuel_logs.receipt_path),
      receipt_original_name = COALESCE(EXCLUDED.receipt_original_name, refuel_logs.receipt_original_name),
      receipt_mime_type = COALESCE(EXCLUDED.receipt_mime_type, refuel_logs.receipt_mime_type),
      receipt_size = COALESCE(EXCLUDED.receipt_size, refuel_logs.receipt_size)
    RETURNING id, station, fuel_name, refuel_date, mileage_km, volume_l, price_per_l, discounted_price_per_l, total_price, discounted_total_price, savings, full_fill, receipt_path, receipt_original_name, receipt_mime_type, receipt_size, vehicle_id
    `,
      [req.user.id, station, fuelName, refuelDate, mileageKm, volumeL, pricePerL, configuredDiscountedPricePerL, totalPrice, discountedTotalPrice, savings, fullFill, receiptFilename, req.file?.originalname || null, req.file?.mimetype || null, req.file?.size || null, vehicleId],
    );
  } catch (error) {
    await removeReceiptFile(receiptFilename);
    throw error;
  }
  if (req.file && existingReceiptResult.rows[0]?.receipt_path && existingReceiptResult.rows[0].receipt_path !== receiptFilename) {
    await removeReceiptFile(existingReceiptResult.rows[0].receipt_path);
  }

  const savedVehicleId = result.rows[0].vehicle_id;
  if (savedVehicleId != null) {
    await updateVehicleAvgConsumption(req.user.id, savedVehicleId);
    await updateVehicleFuelLevel(req.user.id, savedVehicleId);
  }

  return res.status(201).json({
    ok: true,
    refuel: {
      ...result.rows[0],
      refuel_date: refuelDate,
    },
  });
});

app.post("/api/refuels/:id/receipt", receiptUpload.single("receipt"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid refuel id." });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "Vyber účtenku." });
  }

  const receiptFilename = crypto.randomUUID();
  const result = await pool.query(
    `SELECT receipt_path FROM refuel_logs WHERE id = $1 AND user_id = $2`,
    [id, req.user.id],
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ ok: false, error: "Refuel row not found." });
  }

  await fs.promises.writeFile(path.join(receiptUploadDirectory, receiptFilename), req.file.buffer);
  try {
    await pool.query(
      `
      UPDATE refuel_logs
      SET receipt_path = $1, receipt_original_name = $2, receipt_mime_type = $3, receipt_size = $4
      WHERE id = $5 AND user_id = $6
      `,
      [receiptFilename, req.file.originalname, req.file.mimetype, req.file.size, id, req.user.id],
    );
  } catch (error) {
    await removeReceiptFile(receiptFilename);
    throw error;
  }

  await removeReceiptFile(result.rows[0].receipt_path);
  return res.json({
    ok: true,
    receipt: {
      originalName: req.file.originalname,
      size: req.file.size,
    },
  });
});

app.get("/api/refuels/:id/receipt", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid refuel id." });
  }

  const result = await pool.query(
    `SELECT receipt_path, receipt_original_name, receipt_mime_type FROM refuel_logs WHERE id = $1 AND user_id = $2`,
    [id, req.user.id],
  );
  const receipt = result.rows[0];
  if (!receipt?.receipt_path) {
    return res.status(404).json({ ok: false, error: "Receipt not found." });
  }

  const filePath = path.join(receiptUploadDirectory, path.basename(receipt.receipt_path));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "Receipt file not found." });
  }

  res.type(receipt.receipt_mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(receipt.receipt_original_name || "uctenka")}"`);
  return res.sendFile(filePath);
});

async function updateVehicleAvgConsumption(userId, vehicleId) {
  const vRes = await pool.query(
    `SELECT initial_mileage_km FROM vehicles WHERE id = $1 AND user_id = $2`,
    [vehicleId, userId],
  );
  const initialKm = vRes.rows[0]?.initial_mileage_km != null ? Number(vRes.rows[0].initial_mileage_km) : null;

  let query = `SELECT mileage_km, volume_l
     FROM refuel_logs
     WHERE vehicle_id = $1 AND user_id = $2 AND mileage_km IS NOT NULL`;
  const params = [vehicleId, userId];

  if (initialKm != null) {
    query += ` AND mileage_km >= $3`;
    params.push(initialKm);
  }

  query += ` ORDER BY mileage_km ASC`;
  const rows = await pool.query(query, params);

  if (rows.rowCount < 2) return;

  const sorted = rows.rows;
  const totalDistance = Number(sorted[sorted.length - 1].mileage_km) - Number(sorted[0].mileage_km);
  if (totalDistance <= 0) return;

  const totalVolume = sorted.slice(1).reduce((sum, r) => sum + Number(r.volume_l), 0);
  const avg = Number(((totalVolume / totalDistance) * 100).toFixed(2));

  await pool.query(
    `UPDATE vehicles SET avg_consumption_l100 = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [avg, vehicleId, userId],
  );
}

async function updateVehicleFuelLevel(userId, vehicleId) {
  const vRes = await pool.query(
    `SELECT avg_consumption_l100, tank_capacity_l, initial_mileage_km FROM vehicles WHERE id = $1 AND user_id = $2`,
    [vehicleId, userId],
  );
  const v = vRes.rows[0];
  if (!v) return;

  const avgConsumption = v.avg_consumption_l100 != null ? Number(v.avg_consumption_l100) : null;
  const tankCapacity = v.tank_capacity_l != null ? Number(v.tank_capacity_l) : null;
  const initialKm = v.initial_mileage_km != null ? Number(v.initial_mileage_km) : null;

  let query = `SELECT mileage_km, volume_l, full_fill
     FROM refuel_logs
     WHERE vehicle_id = $1 AND user_id = $2`;
  const params = [vehicleId, userId];

  if (initialKm != null) {
    query += ` AND (mileage_km IS NULL OR mileage_km >= $3)`;
    params.push(initialKm);
  }

  query += ` ORDER BY refuel_date ASC, id ASC`;
  const rRes = await pool.query(query, params);
  const refuels = rRes.rows;
  if (refuels.length === 0) return;

  let fuel = 0;
  // Start odometer at initial_mileage_km so the first segment's consumption is correct
  let prevMileage = initialKm;

  for (const r of refuels) {
    const mileage = r.mileage_km != null ? Number(r.mileage_km) : null;

    if (prevMileage != null && mileage != null && avgConsumption != null) {
      const km = mileage - prevMileage;
      if (km > 0) fuel = Math.max(0, fuel - (km / 100) * avgConsumption);
    }

    fuel += Number(r.volume_l);
    if (tankCapacity != null) fuel = Math.min(fuel, tankCapacity);

    // Full fill is an anchor: the tank is now known to be full
    if (r.full_fill && tankCapacity != null) fuel = tankCapacity;

    if (mileage != null) prevMileage = mileage;
  }

  fuel = Math.max(0, Math.round(fuel * 1000) / 1000);

  await pool.query(
    `UPDATE vehicles SET current_fuel_l = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
    [fuel, vehicleId, userId],
  );
}

app.delete("/api/refuels/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid refuel id." });
  }

  const result = await pool.query(
    `
    DELETE FROM refuel_logs
    WHERE id = $1 AND user_id = $2
    RETURNING id, receipt_path
    `,
    [id, req.user.id],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ ok: false, error: "Refuel row not found." });
  }

  await removeReceiptFile(result.rows[0].receipt_path);
  return res.json({ ok: true, deletedId: id });
});

app.get("/api/stations", async (_req, res) => {
  const result = await pool.query(
    `SELECT name FROM stations ORDER BY name`
  );
  res.json(result.rows.map((r) => r.name));
});

app.post("/api/stations", async (req, res) => {
  const name = String(req.body?.name ?? "").trim().toUpperCase();

  if (!name) {
    return res.status(400).json({ ok: false, error: "Station name is required." });
  }

  await pool.query(
    `INSERT INTO stations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
    [name],
  );

  return res.status(201).json({ ok: true, name });
});

app.get("/api/fuels", async (req, res) => {
  const station = String(req.query.station ?? "").trim().toUpperCase();

  const params = [];
  const where = [`user_id = $1`];
  params.push(req.user.id);
  if (station) {
    params.push(station);
    where.push(`station = $${params.length}`);
  }

  const sql = `
    SELECT id, station, fuel_name, fuel_type
    FROM fuels
    WHERE ${where.join(" AND ")}
    ORDER BY station, fuel_name
  `;

  const result = await pool.query(sql, params);
  res.json(result.rows);
});

app.post("/api/fuels", async (req, res) => {
  const station = String(req.body?.station ?? "").trim().toUpperCase();
  const fuelName = String(req.body?.fuel_name ?? "").trim();
  const fuelType = String(req.body?.fuel_type ?? "").trim();

  if (!station) {
    return res.status(400).json({ ok: false, error: "Station is required." });
  }

  if (!fuelName) {
    return res.status(400).json({ ok: false, error: "Fuel name is required." });
  }

  const result = await pool.query(
    `
    INSERT INTO fuels (user_id, station, fuel_name, fuel_type)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, station, fuel_name)
    DO UPDATE SET fuel_type = EXCLUDED.fuel_type
    RETURNING id, station, fuel_name, fuel_type
    `,
    [req.user.id, station, fuelName, fuelType],
  );

  return res.status(201).json({ ok: true, fuel: result.rows[0] });
});

app.put("/api/fuels/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ ok: false, error: "Invalid fuel id." });

  const fuelName = String(req.body?.fuel_name ?? "").trim();
  const fuelType = String(req.body?.fuel_type ?? "").trim();

  if (!fuelName)
    return res.status(400).json({ ok: false, error: "Fuel name is required." });

  const result = await pool.query(
    `UPDATE fuels SET fuel_name = $1, fuel_type = $2 WHERE id = $3
     AND user_id = $4
     RETURNING id, station, fuel_name, fuel_type`,
    [fuelName, fuelType, id, req.user.id],
  );

  if (result.rowCount === 0)
    return res.status(404).json({ ok: false, error: "Fuel not found." });

  return res.json({ ok: true, fuel: result.rows[0] });
});

app.delete("/api/fuels/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ ok: false, error: "Invalid fuel id." });

  const result = await pool.query(`DELETE FROM fuels WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user.id]);

  if (result.rowCount === 0)
    return res.status(404).json({ ok: false, error: "Fuel not found." });

  return res.json({ ok: true, deletedId: id });
});

app.get("/api/prices", async (req, res) => {
  const station = String(req.query.station ?? "").trim().toUpperCase();

  const params = [];
  const where = [`user_id = $1`];
  params.push(req.user.id);
  if (station) {
    params.push(station);
    where.push(`station = $${params.length}`);
  }

  const sql = `
    SELECT id, station, fuel_name, price, TO_CHAR(price_date, 'YYYY-MM-DD') AS price_date
    FROM fuel_prices
    WHERE ${where.join(" AND ")}
    ORDER BY price_date DESC, id DESC, station, fuel_name
  `;

  const result = await pool.query(sql, params);
  res.json(result.rows);
});

app.delete("/api/prices/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid price id." });
  }

  const result = await pool.query(
    `
    DELETE FROM fuel_prices
    WHERE id = $1 AND user_id = $2
    RETURNING id
    `,
    [id, req.user.id],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ ok: false, error: "Price row not found." });
  }

  return res.json({ ok: true, deletedId: id });
});

app.put("/api/prices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const price = Number(req.body?.price);
  const priceDate = String(req.body?.price_date ?? "").trim();
  const nextFuelName = String(req.body?.fuel_name ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid price id." });
  }

  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid price value." });
  }

  if (!priceDate || Number.isNaN(new Date(priceDate).getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid price date." });
  }

  const sourceResult = await pool.query(
    `
    SELECT id, station, fuel_name
    FROM fuel_prices
    WHERE id = $1 AND user_id = $2
    `,
    [id, req.user.id],
  );

  if (sourceResult.rowCount === 0) {
    return res.status(404).json({ ok: false, error: "Price row not found." });
  }

  const sourceRow = sourceResult.rows[0];
  const fuelName = nextFuelName || sourceRow.fuel_name;

  if (!fuelName) {
    return res.status(400).json({ ok: false, error: "Fuel name is required." });
  }

  await ensureFuelExists(req.user.id, sourceRow.station, fuelName);

  const result = await pool.query(
    `
    INSERT INTO fuel_prices (user_id, station, fuel_name, price, price_date)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, station, fuel_name, price, TO_CHAR(price_date, 'YYYY-MM-DD') AS price_date
    `,
    [req.user.id, sourceRow.station, fuelName, price, priceDate],
  );

  return res.json({ ok: true, price: result.rows[0] });
});

app.post("/api/prices", async (req, res) => {
  const station = String(req.body?.station ?? "").trim().toUpperCase();
  const fuelName = String(req.body?.fuel_name ?? "").trim();
  const price = Number(req.body?.price);
  const priceDate = String(req.body?.price_date ?? "").trim();

  if (!station) {
    return res.status(400).json({ ok: false, error: "Station is required." });
  }

  if (!fuelName) {
    return res.status(400).json({ ok: false, error: "Fuel name is required." });
  }

  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid price value." });
  }

  if (!priceDate || Number.isNaN(new Date(priceDate).getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid price date." });
  }

  await ensureFuelExists(req.user.id, station, fuelName);

  const result = await pool.query(
    `
    INSERT INTO fuel_prices (user_id, station, fuel_name, price, price_date)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, station, fuel_name, price, TO_CHAR(price_date, 'YYYY-MM-DD') AS price_date
    `,
    [req.user.id, station, fuelName, price, priceDate],
  );

  return res.status(201).json({ ok: true, price: result.rows[0] });
});

app.get("/api/vehicles", async (req, res) => {
  const result = await pool.query(
    `
    SELECT id, name, car_type, fuel_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, initial_mileage_km, note
    FROM vehicles
    WHERE user_id = $1
    ORDER BY id ASC
    `,
    [req.user.id],
  );
  res.json(result.rows);
});

function parseVehicleBody(body) {
  const name = String(body?.name ?? "").trim() || "Moje auto";
  const carType = String(body?.car_type ?? "").trim();
  const fuelType = String(body?.fuel_type ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const tankCapacityInput = body?.tank_capacity_l;
  const currentFuelInput = body?.current_fuel_l;
  const avgConsumptionInput = body?.avg_consumption_l100;
  const initialMileageInput = body?.initial_mileage_km;
  const tankCapacity = tankCapacityInput === "" || tankCapacityInput == null ? null : Number(tankCapacityInput);
  const currentFuel = currentFuelInput === "" || currentFuelInput == null ? null : Number(currentFuelInput);
  const avgConsumption = avgConsumptionInput === "" || avgConsumptionInput == null ? null : Number(avgConsumptionInput);
  const initialMileage = initialMileageInput === "" || initialMileageInput == null ? null : Number(initialMileageInput);
  return { name, carType, fuelType, note, tankCapacity, currentFuel, avgConsumption, initialMileage };
}

function validateVehicleFields({ tankCapacity, currentFuel, avgConsumption, initialMileage }, res) {
  if (tankCapacity != null && (!Number.isFinite(tankCapacity) || tankCapacity <= 0))
    return res.status(400).json({ ok: false, error: "Invalid tank capacity." });
  if (avgConsumption != null && (!Number.isFinite(avgConsumption) || avgConsumption <= 0))
    return res.status(400).json({ ok: false, error: "Invalid average consumption." });
  if (currentFuel != null && (!Number.isFinite(currentFuel) || currentFuel < 0))
    return res.status(400).json({ ok: false, error: "Invalid current fuel value." });
  if (tankCapacity != null && currentFuel != null && currentFuel > tankCapacity)
    return res.status(400).json({ ok: false, error: "Current fuel cannot exceed tank capacity." });
  if (initialMileage != null && (!Number.isFinite(initialMileage) || initialMileage < 0))
    return res.status(400).json({ ok: false, error: "Invalid initial mileage." });
  return null;
}

app.post("/api/vehicles", async (req, res) => {
  const fields = parseVehicleBody(req.body);
  const err = validateVehicleFields(fields, res);
  if (err) return err;

  const result = await pool.query(
    `
    INSERT INTO vehicles (user_id, name, car_type, fuel_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, initial_mileage_km, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, name, car_type, fuel_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, initial_mileage_km, note
    `,
    [req.user.id, fields.name, fields.carType, fields.fuelType, fields.tankCapacity, fields.currentFuel, fields.avgConsumption, fields.initialMileage, fields.note],
  );

  return res.status(201).json({ ok: true, vehicle: result.rows[0] });
});

app.put("/api/vehicles/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ ok: false, error: "Invalid vehicle id." });

  const fields = parseVehicleBody(req.body);
  const err = validateVehicleFields(fields, res);
  if (err) return err;

  const result = await pool.query(
    `
    UPDATE vehicles
    SET name = $1, car_type = $2, fuel_type = $3, tank_capacity_l = $4, current_fuel_l = $5,
        avg_consumption_l100 = $6, initial_mileage_km = $7, note = $8, updated_at = NOW()
    WHERE id = $9 AND user_id = $10
    RETURNING id, name, car_type, fuel_type, tank_capacity_l, current_fuel_l, avg_consumption_l100, initial_mileage_km, note
    `,
    [fields.name, fields.carType, fields.fuelType, fields.tankCapacity, fields.currentFuel, fields.avgConsumption, fields.initialMileage, fields.note, id, req.user.id],
  );

  if (result.rowCount === 0)
    return res.status(404).json({ ok: false, error: "Vehicle not found." });

  return res.json({ ok: true, vehicle: result.rows[0] });
});

app.delete("/api/vehicles/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ ok: false, error: "Invalid vehicle id." });

  const result = await pool.query(`DELETE FROM vehicles WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user.id]);

  if (result.rowCount === 0)
    return res.status(404).json({ ok: false, error: "Vehicle not found." });

  return res.json({ ok: true, deletedId: id });
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ ok: false, error: "Účtenka může mít nejvýše 10 MB." });
  }
  if (error?.message === "Povolené jsou pouze soubory PDF, PNG, JPG a WebP.") {
    return res.status(400).json({ ok: false, error: error.message });
  }
  return next(error);
});

const port = Number(process.env.PORT || 4000);

async function bootstrap() {
  await runInitMigration();
  await runStationsMigration();
  await runVehicleIdMigration();
  await runFuelTypeMigration();
  await runFuelFuelTypeMigration();
  await runRefuelStationMigration();
  await runRefuelFullFillMigration();
  await runVehicleInitialKmMigration();
  await runAuthMigration();
  await runUserDataScopeMigration();
  await runPasswordResetMigration();
  await runRefuelReceiptMigration();
  app.listen(port, () => {
    console.log(`API ready on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
