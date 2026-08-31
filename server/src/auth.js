import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";

const scryptAsync = promisify(crypto.scrypt);
const sessionCookieName = "tankovani_session";
const sessionDays = Number(process.env.AUTH_SESSION_DAYS || 30);

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function getClientOrigin(req) {
  return process.env.CLIENT_ORIGIN || `${req.protocol}://${req.get("host")}`;
}

function getServerOrigin(req) {
  return process.env.PUBLIC_SERVER_URL || `${req.protocol}://${req.get("host")}`;
}

function getPasswordResetMinutes() {
  const minutes = Number(process.env.AUTH_PASSWORD_RESET_MINUTES || 30);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

function canExposePasswordResetLink() {
  return process.env.NODE_ENV !== "production" || String(process.env.AUTH_PASSWORD_RESET_EXPOSE_TOKEN || "").toLowerCase() === "true";
}

function getGoogleRedirectUri(req) {
  return process.env.GOOGLE_CALLBACK_URL || `${getServerOrigin(req)}/api/auth/google/callback`;
}

function getAllowedEmails() {
  return new Set(
    String(process.env.AUTH_ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

function getAdminEmails() {
  return new Set(
    String(process.env.AUTH_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

async function ensureAdminAccess(userId) {
  const adminEmails = getAdminEmails();
  const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  const isOnlyUser = countResult.rows[0]?.count === 1;
  if (!adminEmails.size && !isOnlyUser) return;

  const userResult = await pool.query("SELECT email, is_admin FROM users WHERE id = $1", [userId]);
  const user = userResult.rows[0];
  if (!user || user.is_admin) return;

  if (isOnlyUser || adminEmails.has(normalizeEmail(user.email))) {
    await pool.query("UPDATE users SET is_admin = true WHERE id = $1", [userId]);
  }
}

function isRegistrationEnabled() {
  return String(process.env.AUTH_ALLOW_REGISTRATION ?? "true").toLowerCase() !== "false";
}

async function hasUsers() {
  const result = await pool.query("SELECT EXISTS (SELECT 1 FROM users) AS has_users");
  return result.rows[0]?.has_users === true;
}

async function canCreateUser(email) {
  if (!(await hasUsers())) return true;
  if (isRegistrationEnabled()) return true;
  return getAllowedEmails().has(normalizeEmail(email));
}

async function canShowRegistration() {
  if (!(await hasUsers())) return true;
  if (isRegistrationEnabled()) return true;
  return getAllowedEmails().size > 0;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  const parts = passwordHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, storedHex] = parts;
  const stored = Buffer.from(storedHex, "hex");
  const key = await scryptAsync(password, salt, stored.length, { N: Number(n), r: Number(r), p: Number(p) });
  const computed = Buffer.isBuffer(key) ? key : Buffer.from(key);
  return stored.length === computed.length && crypto.timingSafeEqual(stored, computed);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return new Map();
  return new Map(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      const key = index >= 0 ? part.slice(0, index).trim() : part.trim();
      const value = index >= 0 ? part.slice(index + 1).trim() : "";
      return [key, decodeURIComponent(value)];
    }),
  );
}

function getSessionToken(req) {
  return parseCookies(req).get(sessionCookieName) || "";
}

function sessionCookie(value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" || String(process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "true";
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    hasPassword: row.has_password ?? Boolean(row.password_hash),
    isAdmin: row.is_admin === true,
  };
}

async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, name, password_hash, password_hash IS NOT NULL AS has_password, created_at, is_admin FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] ?? null;
}

async function createUser({ email, name, password }) {
  const passwordHash = password ? await hashPassword(password) : null;
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, password_hash IS NOT NULL AS has_password, created_at`,
    [normalizeEmail(email), String(name ?? "").trim(), passwordHash],
  );
  await claimLegacyDataForFirstUser(result.rows[0].id);
  return result.rows[0];
}

async function claimLegacyDataForFirstUser(userId) {
  const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (countResult.rows[0]?.count !== 1) return;

  await pool.query(`UPDATE vehicles SET user_id = $1 WHERE user_id IS NULL`, [userId]);
  await pool.query(`UPDATE fuels SET user_id = $1 WHERE user_id IS NULL`, [userId]);
  await pool.query(`UPDATE fuel_prices SET user_id = $1 WHERE user_id IS NULL`, [userId]);
  await pool.query(`UPDATE refuel_logs SET user_id = $1 WHERE user_id IS NULL`, [userId]);
}

async function createSession(res, userId) {
  await ensureAdminAccess(userId);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  res.setHeader("Set-Cookie", sessionCookie(token, sessionDays * 24 * 60 * 60));
}

async function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + getPasswordResetMinutes() * 60 * 1000);
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  return { token, expiresAt };
}

async function clearSession(req, res) {
  const token = getSessionToken(req);
  if (token) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
  res.setHeader("Set-Cookie", sessionCookie("", 0));
}

export async function authenticateOptional(req, _res, next) {
  const token = getSessionToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.password_hash IS NOT NULL AS has_password, u.created_at, u.is_admin
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)],
  );

  req.user = result.rows[0] ?? null;
  return next();
}

export async function requireAuth(req, res, next) {
  await authenticateOptional(req, res, () => undefined);
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "Authentication required." });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ ok: false, error: "Vyžaduje oprávnění správce." });
  }
  return next();
}

export function installAuthRoutes(app) {
  app.get("/api/auth/config", async (req, res) => {
    res.json({
      googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      registrationAllowed: await canShowRegistration(),
      clientOrigin: getClientOrigin(req),
    });
  });

  app.get("/api/auth/me", authenticateOptional, (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  app.post("/api/auth/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const name = String(req.body?.name ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Zadej platný e-mail." });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "Heslo musí mít alespoň 8 znaků." });
    if (!(await canCreateUser(email))) return res.status(403).json({ ok: false, error: "Registrace není povolená." });
    if (await findUserByEmail(email)) return res.status(409).json({ ok: false, error: "Uživatel už existuje." });

    const user = await createUser({ email, name, password });
    await createSession(res, user.id);
    res.status(201).json({ ok: true, user: publicUser(user) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? "");
    const user = await findUserByEmail(email);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ ok: false, error: "Neplatný e-mail nebo heslo." });
    }

    await createSession(res, user.id);
    res.json({ ok: true, user: publicUser(user) });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const user = email ? await findUserByEmail(email) : null;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Zadej platný e-mail." });
    }

    if (!user) {
      return res.json({ ok: true });
    }

    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1 AND (used_at IS NOT NULL OR expires_at <= NOW())`, [user.id]);
    const reset = await createPasswordReset(user.id);
    const resetUrl = `${getClientOrigin(req)}?resetToken=${encodeURIComponent(reset.token)}`;
    console.info(`Password reset for ${user.email}: ${resetUrl}`);

    const response = { ok: true };
    if (canExposePasswordResetLink()) {
      response.resetUrl = resetUrl;
      response.expiresAt = reset.expiresAt.toISOString();
    }
    res.json(response);
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const token = String(req.body?.token ?? "");
    const password = String(req.body?.password ?? "");

    if (!token) return res.status(400).json({ ok: false, error: "Odkaz pro obnovu hesla není platný." });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "Heslo musí mít alespoň 8 znaků." });

    const result = await pool.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashToken(token)],
    );

    const userId = result.rows[0]?.user_id;
    if (!userId) return res.status(400).json({ ok: false, error: "Odkaz pro obnovu hesla vypršel nebo už byl použit." });

    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [await hashPassword(password), userId]);
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await createSession(res, userId);

    const userResult = await pool.query(
      `SELECT id, email, name, password_hash IS NOT NULL AS has_password, created_at, is_admin FROM users WHERE id = $1`,
      [userId],
    );
    res.json({ ok: true, user: publicUser(userResult.rows[0]) });
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    if (newPassword.length < 8) return res.status(400).json({ ok: false, error: "Nové heslo musí mít alespoň 8 znaků." });

    const result = await pool.query(`SELECT id, email, name, password_hash, created_at, is_admin FROM users WHERE id = $1`, [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "Uživatel nebyl nalezen." });

    if (user.password_hash && !(await verifyPassword(currentPassword, user.password_hash))) {
      return res.status(401).json({ ok: false, error: "Aktuální heslo není správné." });
    }

    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [await hashPassword(newPassword), user.id]);
    await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, hashToken(getSessionToken(req))]);
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", async (req, res) => {
    await clearSession(req, res);
    res.json({ ok: true });
  });

  app.get("/api/auth/google", async (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ ok: false, error: "Google přihlášení není nakonfigurované." });
    }

    const state = crypto.randomBytes(24).toString("base64url");
    await pool.query(
      `INSERT INTO oauth_states (state, expires_at) VALUES ($1, NOW() + INTERVAL '10 minutes')`,
      [state],
    );

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: getGoogleRedirectUri(req),
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const clientOrigin = getClientOrigin(req);
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    const stateResult = await pool.query(
      `DELETE FROM oauth_states WHERE state = $1 AND expires_at > NOW() RETURNING state`,
      [state],
    );

    if (!code || stateResult.rowCount === 0) {
      return res.redirect(`${clientOrigin}?authError=${encodeURIComponent("Google přihlášení vypršelo nebo není platné.")}`);
    }

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: getGoogleRedirectUri(req),
        }),
      });

      if (!tokenResponse.ok) throw new Error("Token exchange failed");
      const tokenData = await tokenResponse.json();
      const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userInfoResponse.ok) throw new Error("Userinfo failed");
      const profile = await userInfoResponse.json();
      const email = normalizeEmail(profile.email);
      if (!email || profile.email_verified !== true) {
        return res.redirect(`${clientOrigin}?authError=${encodeURIComponent("Google účet nemá ověřený e-mail.")}`);
      }

      let user = await findUserByEmail(email);
      if (!user) {
        if (!(await canCreateUser(email))) {
          return res.redirect(`${clientOrigin}?authError=${encodeURIComponent("Tento Google účet nemá povolený přístup.")}`);
        }
        user = await createUser({ email, name: profile.name || "", password: null });
      }

      await pool.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
         VALUES ($1, 'google', $2)
         ON CONFLICT (provider, provider_account_id)
         DO UPDATE SET user_id = EXCLUDED.user_id`,
        [user.id, String(profile.sub)],
      );

      await createSession(res, user.id);
      return res.redirect(`${clientOrigin}?auth=google`);
    } catch (error) {
      console.error(error);
      return res.redirect(`${clientOrigin}?authError=${encodeURIComponent("Google přihlášení selhalo.")}`);
    }
  });
}
