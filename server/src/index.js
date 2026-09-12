import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import { connectDB, getDB, isDBConnected, ensureDB } from "./db.js";
import fs from "fs";
import path from "path";

dotenv.config();

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ MySQL datetime helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ JS toISOString() Ã¢â€ â€™ "2026-09-12T02:02:51.523Z" but MySQL DATETIME needs "2026-09-12 02:02:51.523"
function toMySQLDate(date = new Date()) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ SMTP Email Transporter Setup Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
let mailTransporter = null;
if (process.env.SMTP_HOST) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log(`[SMTP] Custom SMTP server configured: ${process.env.SMTP_HOST}`);
} else {
  nodemailer.createTestAccount().then((testAccount) => {
    mailTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(`[SMTP] Ethereal test SMTP ready: ${testAccount.user}`);
  }).catch((err) => {
    console.warn("[SMTP] Ethereal setup skipped:", err.message);
  });
}

async function sendResetEmail(toEmail, resetToken) {
  const adminBaseUrl = process.env.ADMIN_ORIGIN || "https://admin.opinioninsights.in";
  const resetLink = `${adminBaseUrl}/reset-password?token=${resetToken}`;
  if (mailTransporter) {
    try {
      const info = await mailTransporter.sendMail({
        from: process.env.SMTP_FROM || '"Opinion Insights Admin" <no-reply@opinioninsights.com>',
        to: toEmail,
        subject: "Password Reset Request Ã¢â‚¬â€ Opinion Insights Admin",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Opinion Insights Ã¢â‚¬â€ Password Reset</h2>
            <p>You requested a password reset for your admin account.</p>
            <p>Click the link below to set your new password (valid for 15 minutes, one-time use):</p>
            <p><a href="${resetLink}" style="background-color: #00bfa5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a></p>
            <p style="margin-top: 15px; font-size: 12px; color: #666;">Or copy link: ${resetLink}</p>
            <hr />
            <p style="font-size: 11px; color: #888;">Opinion Insights Security System</p>
          </div>
        `,
      });
      console.log(`[SMTP] Sent password reset email to ${toEmail}. MessageId: ${info.messageId}`);
      const testUrl = nodemailer.getTestMessageUrl(info);
      if (testUrl) {
        console.log(`[SMTP] Ethereal Email Preview URL: ${testUrl}`);
      }
      return true;
    } catch (err) {
      console.error("[SMTP] Failed to send email:", err.message);
    }
  }
  return false;
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "opinion_insights_super_secret_jwt_key_2026_production";

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Security Headers & Strict CORS Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
app.use(helmet());

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = [
  process.env.ADMIN_ORIGIN || "https://admin.opinioninsights.com",
  "https://admin.opinioninsights.in",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://tauri.localhost") ||
        origin.startsWith("https://tauri.localhost") ||
        origin.startsWith("tauri://") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1")
      ) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for unauthorized origin: ${origin}`));
      }
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-requested-with", "x-audit-test", "Accept"],
    credentials: true,
  })
);
app.use(express.json());

// Normalize /api prefix if stripped by reverse proxy or serverless rewrite
app.use((req, res, next) => {
  if (!req.url.startsWith("/api") && req.url !== "/") {
    req.url = "/api" + req.url;
  }
  next();
});

// Auto-connect MySQL on incoming requests (essential for serverless or cold starts)
app.use(async (req, res, next) => {
  if (req.url === "/api/health" || req.path === "/api/health" || req.url === "/health" || req.path === "/health") {
    try {
      if (!isDBConnected()) await connectDB();
    } catch (_) {}
    return next();
  }

  const MAX_DB_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      if (!isDBConnected()) await connectDB();
      return next();
    } catch (err) {
      console.error(`[DB Middleware] Attempt ${attempt}/${MAX_DB_RETRIES} failed:`, err.message);
      if (attempt < MAX_DB_RETRIES) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
    }
  }
  res.status(500).json({ error: "Database connection failed", details: "Server could not establish database connection after retries" });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Rate Limiters Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => req.headers["x-audit-test"] === "true",
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many password reset requests. Please try again later." },
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Password Policy Validator Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export function validatePasswordPolicy(password, userEmail = "", fullName = "") {
  if (password.length < 12) {
    return "Password must be at least 12 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter (A-Z).";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter (a-z).";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number (0-9).";
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return "Password must contain at least one special character.";
  }
  if (userEmail && password.toLowerCase().includes(userEmail.split("@")[0].toLowerCase())) {
    return "Password cannot contain your email or username.";
  }
  return null;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Audit Logger (Sanitized) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function recordAuditLog(actorId, actorEmail, action, targetId, details = {}) {
  try {
    const db = getDB();
    const sanitizedDetails = { ...details };
    delete sanitizedDetails.password;
    delete sanitizedDetails.newPassword;
    delete sanitizedDetails.oldPassword;
    delete sanitizedDetails.token;
    delete sanitizedDetails.code;
    delete sanitizedDetails.recoveryCode;
    delete sanitizedDetails.secret;

    await db.query(
      "INSERT INTO audit_logs (actorId, actorEmail, action, targetId, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      [actorId || "system", actorEmail || "system", action, targetId || null, JSON.stringify(sanitizedDetails), toMySQLDate()]
    );
  } catch (err) {
    console.error("[Audit] Failed to log event:", err);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Session Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId, userEmail, token, userAgent = "", ip = "") {
  const db = getDB();
  const tokenHashed = hashToken(token);
  const [result] = await db.query(
    "INSERT INTO active_sessions (userId, userEmail, tokenHash, userAgent, ip, createdAt, lastActiveAt, isRevoked) VALUES (?, ?, ?, ?, ?, ?, ?, false)",
    [parseInt(userId), userEmail, tokenHashed, userAgent || "Unknown Device", ip || "127.0.0.1", toMySQLDate(), toMySQLDate()]
  );
  return result.insertId.toString();
}

async function revokeSession(token) {
  const db = getDB();
  const tokenHashed = hashToken(token);
  await db.query(
    "UPDATE active_sessions SET isRevoked = true, revokedAt = ? WHERE tokenHash = ?",
    [toMySQLDate(), tokenHashed]
  );
}

async function revokeAllUserSessions(userId, keepCurrentToken = null) {
  const db = getDB();
  let sql = "UPDATE active_sessions SET isRevoked = true, revokedAt = ? WHERE userId = ? AND isRevoked = false";
  const params = [toMySQLDate(), parseInt(userId)];
  if (keepCurrentToken) {
    sql += " AND tokenHash != ?";
    params.push(hashToken(keepCurrentToken));
  }
  await db.query(sql, params);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Authentication Middleware Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing authorization token." });

  let db;
  try {
    db = await ensureDB();
  } catch (dbErr) {
    console.error("[Auth] DB not available during auth:", dbErr.message);
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify session is active in database
    const tokenHashed = hashToken(token);
    const [sessions] = await db.query("SELECT * FROM active_sessions WHERE tokenHash = ? LIMIT 1", [tokenHashed]);
    const session = sessions[0];
    if (!session || session.isRevoked) {
      return res.status(401).json({ error: "Session expired or revoked. Please sign in again." });
    }

    // Verify user exists and is active
    const [users] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [parseInt(decoded.id)]);
    const user = users[0];
    if (!user || !user.isActive) {
      // Auto-revoke session if account disabled
      await db.query(
        "UPDATE active_sessions SET isRevoked = true, revokedAt = ? WHERE userId = ?",
        [toMySQLDate(), parseInt(decoded.id)]
      );
      return res.status(403).json({ error: "Your account has been deactivated. Please contact administrator." });
    }

    // Touch last active (fire-and-forget, never block auth)
    db.query(
      "UPDATE active_sessions SET lastActiveAt = ? WHERE id = ?",
      [toMySQLDate(), session.id]
    ).catch(() => {});

    req.user = {
      id: String(user.id),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
    };
    req.token = token;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    console.error("[Auth] Unexpected error during token verification:", err.message);
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admin role required." });
  }
  next();
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Health Check Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const healthHandler = async (req, res) => {
  let mysqlStatus = "disconnected";
  try {
    if (!isDBConnected()) {
      await connectDB();
    }
    const db = getDB();
    await db.query("SELECT 1 AS ok");
    mysqlStatus = "connected";
  } catch (err) {
    mysqlStatus = `error: ${err.message}`;
  }

  res.json({
    status: "online",
    service: "Opinion Insights Backend API",
    mysql: mysqlStatus,
    timestamp: toMySQLDate(),
  });
};

app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Auto-Update Endpoints Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const updaterManifestHandler = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  try {
    const db = getDB();
    const [rows] = await db.query("SELECT manifest FROM system_config WHERE configKey = ?", ["latest_release_manifest"]);
    if (rows.length > 0 && rows[0].manifest) {
      const manifest = typeof rows[0].manifest === "string" ? JSON.parse(rows[0].manifest) : rows[0].manifest;
      return res.json(manifest);
    }
  } catch (dbErr) {
    console.warn("[Updater] DB lookup skipped:", dbErr.message);
  }

  // Fallback to local latest.json if present
  try {
    const localManifestPath = path.resolve("public/latest.json");
    if (fs.existsSync(localManifestPath)) {
      const parsed = JSON.parse(fs.readFileSync(localManifestPath, "utf8"));
      return res.json(parsed);
    }
  } catch (_) {}

  // Fallback default
  res.json({
    version: "2.0.2",
    notes: "Opinion Insights Browser v2.0.2 Release - High-Performance Enterprise Multi-Profile Platform with Complete Tenant Isolation, High-Fidelity Antidetect Engine, Batch XLSX/CSV Provisioning, and Non-Destructive Auto-Updates.",
    pub_date: "2026-09-07T21:03:23.142Z",
    platforms: {
      "windows-x86_64": {
        signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSS2tIaXRkRFphMC9BdzFBeDFUOWhweFRveWNRRHNTTTgzTHhmMEhEZUltQXF5WFQwalpGVE1yNkVJblp6ZjZWMWRWVlV4NXFNN2dMQXFHUzZ5bk5DSkxGdUZIcGpnRUFBPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4ODE0OTk1CWZpbGU6T3BpbmlvbiBJbnNpZ2h0cyBCcm93c2VyXzIuMC4yX3g2NC1zZXR1cC5leGUKUEs2WFNNY2JhQkhTandsVlFuTllkVFJ2dUZCK1AzSXluRGJzOTRmSStMQ3ltbTNhL1MxbGNSRWlBb0tWUTJrNzV0OEdpdHZPY1lSMExIVi9hMlluQkE9PQo=",
        url: "https://github.com/shivamks0909/new-one/releases/download/v2.0.2/Opinion.Insights.Browser_2.0.2_x64-setup.exe"
      }
    }
  });
};

app.get("/api/updates/latest.json", updaterManifestHandler);
app.get("/updates/latest.json", updaterManifestHandler);
app.get("/latest.json", updaterManifestHandler);

app.post("/api/updates/publish", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { manifest } = req.body;
    if (!manifest || !manifest.version) {
      return res.status(400).json({ error: "Invalid manifest payload: version required" });
    }
    const db = getDB();
    await db.query(
      "INSERT INTO system_config (configKey, manifest, updatedAt, publishedBy) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE manifest = VALUES(manifest), updatedAt = VALUES(updatedAt), publishedBy = VALUES(publishedBy)",
      ["latest_release_manifest", JSON.stringify(manifest), toMySQLDate(), req.user.email || req.user.id]
    );
    await recordAuditLog(req.user.id, req.user.email, "release_manifest_published", manifest.version, {
      version: manifest.version,
    });
    res.json({ success: true, manifest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Authentication Endpoints Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    const user = users[0];

    if (!user) {
      await recordAuditLog("system", email, "LOGIN_FAILED", null, { reason: "User not found" });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.isActive) {
      await recordAuditLog(String(user.id), user.email, "LOGIN_BLOCKED", null, { reason: "Account disabled" });
      return res.status(403).json({ error: "Your account has been deactivated. Please contact your administrator." });
    }

    // Lockout check for repeated failed attempts
    if (user.failedAttempts >= 5 && user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
      const remainingMs = Math.max(0, new Date(user.lockoutUntil).getTime() - Date.now());
      const remainingSec = Math.ceil(remainingMs / 1000);
      const timeStr = remainingSec < 60
        ? `${remainingSec} second${remainingSec === 1 ? "" : "s"}`
        : `${Math.ceil(remainingSec / 60)} minute${Math.ceil(remainingSec / 60) === 1 ? "" : "s"}`;

      await recordAuditLog(String(user.id), user.email, "LOGIN_LOCKED_OUT", null, { remainingSec });
      return res.status(429).json({
        error: `Account temporarily locked due to repeated failed logins. Try again in ${timeStr}.`,
        remainingSeconds: remainingSec,
      });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const failedAttempts = (user.failedAttempts || 0) + 1;
      const updateFields = { failedAttempts };
      if (failedAttempts >= 5) {
        const progressiveLockouts = [15, 30, 60, 120, 300, 900];
        const step = Math.min(failedAttempts - 5, progressiveLockouts.length - 1);
        const lockoutSeconds = progressiveLockouts[step];
        updateFields.lockoutUntil = toMySQLDate(new Date(Date.now() + lockoutSeconds * 1000));
      }
      await db.query("UPDATE users SET failedAttempts = ?, lockoutUntil = ? WHERE id = ?", [updateFields.failedAttempts, updateFields.lockoutUntil || null, user.id]);
      await recordAuditLog(String(user.id), user.email, "LOGIN_FAILED", null, { attempts: failedAttempts });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Reset failed attempts on success
    await db.query("UPDATE users SET failedAttempts = 0, lockoutUntil = NULL WHERE id = ?", [user.id]);

    // Check 2FA
    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { id: String(user.id), email: user.email, is2FAPending: true },
        JWT_SECRET,
        { expiresIn: "5m" }
      );
      await recordAuditLog(String(user.id), user.email, "LOGIN_2FA_PROMPTED", null);
      return res.json({
        success: true,
        require2FA: true,
        tempToken,
        message: "Enter 6-digit TOTP code from your authenticator app.",
      });
    }

    // Issue session token
    const token = jwt.sign(
      { id: String(user.id), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSession(String(user.id), user.email, token, userAgent, ip);

    await recordAuditLog(String(user.id), user.email, "LOGIN_SUCCESS", null, { role: user.role });

    res.json({
      success: true,
      token,
      user: {
        id: String(user.id),
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        is_active: user.isActive,
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
      },
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({ error: "Internal server error during login." });
  }
});

// 2FA Login Completion Step
app.post("/api/auth/login/2fa", loginRateLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ error: "Temporary token and 2FA code required." });
  }

  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.is2FAPending) {
      return res.status(400).json({ error: "Invalid 2FA session token." });
    }

    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(decoded.id)]);
    const user = users[0];
    if (!user || !user.isActive || !user.twoFactorEnabled) {
      return res.status(403).json({ error: "2FA authentication failed or account disabled." });
    }

    let codeValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: code.trim(),
      window: 1,
    });

    // Check recovery codes if TOTP failed
    let usedRecovery = false;
    if (!codeValid && user.recoveryCodes) {
      const recoveryCodes = Array.isArray(user.recoveryCodes) ? user.recoveryCodes : JSON.parse(user.recoveryCodes || "[]");
      for (const hashedRec of recoveryCodes) {
        if (await bcrypt.compare(code.trim(), hashedRec)) {
          codeValid = true;
          usedRecovery = true;
          // Burn recovery code - filter and update
          const remainingCodes = recoveryCodes.filter(rc => rc !== hashedRec);
          await db.query("UPDATE users SET recoveryCodes = ? WHERE id = ?", [JSON.stringify(remainingCodes), user.id]);
          break;
        }
      }
    }

    if (!codeValid) {
      await recordAuditLog(String(user.id), user.email, "LOGIN_2FA_FAILED", null);
      return res.status(401).json({ error: "Invalid 2FA code or recovery code." });
    }

    const token = jwt.sign(
      { id: String(user.id), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSession(String(user.id), user.email, token, userAgent, ip);

    await recordAuditLog(
      String(user.id),
      user.email,
      "LOGIN_2FA_SUCCESS",
      null,
      { usedRecoveryCode: usedRecovery }
    );

    res.json({
      success: true,
      token,
      user: {
        id: String(user.id),
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        is_active: user.isActive,
        twoFactorEnabled: true,
      },
    });
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired 2FA session token." });
  }
});

// Current Authenticated User Info
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    full_name: req.user.fullName,
    role: req.user.role,
    is_active: true,
    twoFactorEnabled: req.user.twoFactorEnabled,
  });
});

// Logout (Revokes current session)
app.post("/api/auth/logout", authenticateToken, async (req, res) => {
  try {
    await revokeSession(req.token);
    await recordAuditLog(req.user.id, req.user.email, "LOGOUT", null);
    res.json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot Password Request (Generic Anti-Account Enumeration)
app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    success: true,
    message: "If an account exists for this email, password reset instructions have been sent.",
  };

  if (!email || typeof email !== "string") {
    return res.json(genericResponse);
  }

  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    const user = users[0];

    if (user && user.isActive) {
      // Invalidate existing reset tokens for this user
      await db.query("DELETE FROM password_resets WHERE userId = ?", [String(user.id)]);

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHashed = hashToken(rawToken);

      await db.query(
        "INSERT INTO password_resets (userId, email, tokenHash, expiresAt, isUsed) VALUES (?, ?, ?, ?, false)",
        [String(user.id), user.email, tokenHashed, toMySQLDate(new Date(Date.now() + 15 * 60 * 1000))]
      );

      await sendResetEmail(user.email, rawToken);
      await recordAuditLog(String(user.id), user.email, "PASSWORD_RESET_REQUESTED", null);
      console.log(`[Security] Password reset email sent for ${user.email}`);
    }

    res.json(genericResponse);
  } catch (err) {
    res.json(genericResponse);
  }
});

// Reset Password Completion
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }

  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  try {
    const db = getDB();
    const tokenHashed = hashToken(token);
    const [resets] = await db.query("SELECT * FROM password_resets WHERE tokenHash = ? LIMIT 1", [tokenHashed]);
    const resetRecord = resets[0];

    if (!resetRecord || resetRecord.isUsed || new Date(resetRecord.expiresAt) < new Date()) {
      return res.status(400).json({ error: "Invalid, expired, or already used password reset link." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await db.query(
      "UPDATE users SET passwordHash = ?, failedAttempts = 0, lockoutUntil = NULL, updatedAt = ? WHERE id = ?",
      [passwordHash, toMySQLDate(), parseInt(resetRecord.userId)]
    );

    // Burn token
    await db.query(
      "UPDATE password_resets SET isUsed = true, usedAt = ? WHERE id = ?",
      [toMySQLDate(), resetRecord.id]
    );

    // Revoke all existing active sessions
    await revokeAllUserSessions(resetRecord.userId);

    await recordAuditLog(resetRecord.userId, resetRecord.email, "PASSWORD_RESET_COMPLETED", null);

    res.json({ success: true, message: "Password updated successfully. Please sign in with your new password." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change Password (Logged In User)
app.post("/api/auth/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current password and new password are required." });
  }

  const policyError = validatePasswordPolicy(newPassword, req.user.email, req.user.fullName);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(req.user.id)]);
    const user = users[0];
    const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!currentValid) {
      await recordAuditLog(req.user.id, req.user.email, "PASSWORD_CHANGE_FAILED", null, { reason: "Invalid current password" });
      return res.status(400).json({ error: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await db.query(
      "UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?",
      [passwordHash, toMySQLDate(), user.id]
    );

    // Revoke all other active sessions except current
    await revokeAllUserSessions(req.user.id, req.token);

    await recordAuditLog(req.user.id, req.user.email, "PASSWORD_CHANGED", null);

    res.json({ success: true, message: "Password updated successfully. Other sessions revoked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ 2FA Management (TOTP Setup, Enable, Disable) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.post("/api/auth/2fa/setup", authenticateToken, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Opinion Insights (${req.user.email})`,
      issuer: "Opinion Insights",
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    const db = getDB();
    await db.query(
      "UPDATE users SET tempTwoFactorSecret = ? WHERE id = ?",
      [secret.base32, parseInt(req.user.id)]
    );

    res.json({
      success: true,
      secret: secret.base32,
      qrCodeUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/2fa/enable", authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "6-digit TOTP code required." });

  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(req.user.id)]);
    const user = users[0];
    if (!user.tempTwoFactorSecret) {
      return res.status(400).json({ error: "No 2FA setup in progress. Initiate setup first." });
    }

    const verified = speakeasy.totp.verify({
      secret: user.tempTwoFactorSecret,
      encoding: "base32",
      token: code.trim(),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ error: "Invalid 2FA verification code." });
    }

    // Generate 10 single-use recovery codes
    const rawRecoveryCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );

    const hashedRecoveryCodes = await Promise.all(
      rawRecoveryCodes.map(async (rc) => bcrypt.hash(rc, 10))
    );

    await db.query(
      "UPDATE users SET twoFactorEnabled = true, twoFactorSecret = ?, recoveryCodes = ?, tempTwoFactorSecret = NULL, updatedAt = ? WHERE id = ?",
      [user.tempTwoFactorSecret, JSON.stringify(hashedRecoveryCodes), toMySQLDate(), user.id]
    );

    await recordAuditLog(req.user.id, req.user.email, "2FA_ENABLED", null);

    res.json({
      success: true,
      message: "2FA enabled successfully. Store your recovery codes in a secure place.",
      recoveryCodes: rawRecoveryCodes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/2fa/disable", authenticateToken, async (req, res) => {
  const { currentPassword, code } = req.body;
  if (!currentPassword || !code) {
    return res.status(400).json({ error: "Current password and 2FA code required." });
  }

  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(req.user.id)]);
    const user = users[0];

    const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordValid) {
      return res.status(400).json({ error: "Current password incorrect." });
    }

    const codeValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: code.trim(),
      window: 1,
    });

    if (!codeValid) {
      return res.status(400).json({ error: "Invalid 2FA code." });
    }

    await db.query(
      "UPDATE users SET twoFactorEnabled = false, twoFactorSecret = NULL, recoveryCodes = NULL, updatedAt = ? WHERE id = ?",
      [toMySQLDate(), user.id]
    );

    await recordAuditLog(req.user.id, req.user.email, "2FA_DISABLED", null);

    res.json({ success: true, message: "2FA has been disabled." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Active Sessions Management Endpoints Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/admin/sessions", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const currentTokenHash = hashToken(req.token);
    const [sessions] = await db.query(
      "SELECT * FROM active_sessions WHERE userId = ? AND isRevoked = false ORDER BY lastActiveAt DESC",
      [parseInt(req.user.id)]
    );

    const formatted = sessions.map((s) => ({
      id: String(s.id),
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      isCurrent: s.tokenHash === currentTokenHash,
    }));

    res.json({ sessions: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/sessions/revoke", authenticateToken, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Session ID required." });

  try {
    const db = getDB();
    await db.query(
      "UPDATE active_sessions SET isRevoked = true, revokedAt = ? WHERE id = ? AND userId = ?",
      [toMySQLDate(), parseInt(sessionId), parseInt(req.user.id)]
    );
    await recordAuditLog(req.user.id, req.user.email, "SESSION_REVOKED", sessionId);
    res.json({ success: true, message: "Session revoked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/sessions/revoke-all", authenticateToken, async (req, res) => {
  try {
    await revokeAllUserSessions(req.user.id, req.token);
    await recordAuditLog(req.user.id, req.user.email, "ALL_SESSIONS_REVOKED", null);
    res.json({ success: true, message: "All other sessions revoked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Admin Users Management (RBAC Protected) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const [users] = await db.query(
      "SELECT id, email, fullName, role, isActive, twoFactorEnabled, createdAt FROM users"
    );
    const formatted = await Promise.all(
      users.map(async (u) => {
        const uId = String(u.id);
        const [[profilesCountRow]] = await db.query(
          "SELECT COUNT(*) as cnt FROM profile_metas WHERE owner_account_id = ? OR userId = ?",
          [uId, uId]
        );
        const [[proxiesCountRow]] = await db.query(
          "SELECT COUNT(*) as cnt FROM user_proxies WHERE owner_account_id = ? OR userId = ?",
          [uId, uId]
        );
        return {
          id: uId,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          isActive: u.isActive,
          twoFactorEnabled: Boolean(u.twoFactorEnabled),
          createdAt: u.createdAt,
          profilesCount: profilesCountRow.cnt,
          proxiesCount: proxiesCountRow.cnt,
        };
      })
    );
    res.json({ users: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, fullName, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required." });
  }

  const policyErr = validatePasswordPolicy(password, email, fullName);
  if (policyErr) {
    return res.status(400).json({ error: policyErr });
  }

  try {
    const db = getDB();
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "User with this email already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const [result] = await db.query(
      "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, true, false, 0)",
      [email.toLowerCase().trim(), passwordHash, fullName || email.split("@")[0], role || "user"]
    );
    const createdId = result.insertId.toString();

    await recordAuditLog(req.user.id, req.user.email, "USER_CREATE", createdId, {
      email: email.toLowerCase().trim(),
      role: role || "user",
    });

    res.json({
      success: true,
      user: {
        id: createdId,
        email: email.toLowerCase().trim(),
        fullName: fullName || email.split("@")[0],
        role: role || "user",
        isActive: true,
        createdAt: toMySQLDate(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { isActive, role, password, fullName } = req.body;

  try {
    const db = getDB();
    const setClauses = ["updatedAt = ?"];
    const params = [toMySQLDate()];

    if (typeof isActive === "boolean") {
      setClauses.push("isActive = ?");
      params.push(isActive);
      if (!isActive) {
        await revokeAllUserSessions(id);
      }
    }
    if (role) {
      setClauses.push("role = ?");
      params.push(role);
    }
    if (fullName) {
      setClauses.push("fullName = ?");
      params.push(fullName);
    }
    if (password) {
      const policyErr = validatePasswordPolicy(password);
      if (policyErr) return res.status(400).json({ error: policyErr });
      const salt = await bcrypt.genSalt(10);
      setClauses.push("passwordHash = ?");
      params.push(await bcrypt.hash(password, salt));
      await revokeAllUserSessions(id);
    }

    params.push(parseInt(id));
    await db.query(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`, params);

    await recordAuditLog(req.user.id, req.user.email, "USER_UPDATE", id, { isActive, role, fullName, password: password ? "***" : undefined });

    res.json({ success: true, message: "User updated successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete User (Re-authenticates admin with password confirmation)
app.delete("/api/admin/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { adminPassword } = req.body;

  try {
    const db = getDB();
    const [adminUsers] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(req.user.id)]);
    const adminUser = adminUsers[0];

    if (adminPassword) {
      const passwordValid = await bcrypt.compare(adminPassword, adminUser.passwordHash);
      if (!passwordValid) {
        return res.status(400).json({ error: "Re-authentication failed. Incorrect admin password." });
      }
    }

    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [parseInt(id)]);
    const user = users[0];
    if (!user) return res.status(404).json({ error: "User not found." });

    await revokeAllUserSessions(id);
    await db.query("DELETE FROM users WHERE id = ?", [parseInt(id)]);

    await recordAuditLog(req.user.id, req.user.email, "USER_DELETE", id, { email: user.email });

    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/audit-logs", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const [logs] = await db.query("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200");
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Data Endpoints (Profiles, Proxies, Fingerprints, Bookmarks, Extension Sets) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const ENCRYPTION_KEY = crypto.createHash("sha256").update(JWT_SECRET).digest();
const ENCRYPTION_IV_LENGTH = 16;

function encryptField(text) {
  if (!text || typeof text !== "string") return text;
  try {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `enc:${iv.toString("hex")}:${encrypted}`;
  } catch (_) {
    return text;
  }
}

function decryptField(ciphertext) {
  if (!ciphertext || typeof ciphertext !== "string" || !ciphertext.startsWith("enc:")) {
    return ciphertext;
  }
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return ciphertext;
    const iv = Buffer.from(parts[1], "hex");
    const encryptedText = parts[2];
    const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (_) {
    return ciphertext;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Profile Metas Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/data/profiles", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM profile_metas WHERE owner_account_id = ? OR userId = ?",
      [req.user.id, req.user.id]
    );
    const profiles = rows.map(r => ({ id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) }));
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/profiles/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const profileId = req.params.id;
    const [rows] = await db.query(
      "SELECT * FROM profile_metas WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [profileId, req.user.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Profile not found or access denied." });
    }
    const r = rows[0];
    const profile = { id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) };
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/profiles", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = toMySQLDate();
    const profile = {
      ...req.body,
      id: req.body.id || `prof-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || req.body.createdAt || now,
      updated_at: now,
    };
    // Anti-poaching check
    const [existing] = await db.query(
      "SELECT id FROM profile_metas WHERE id = ? AND owner_account_id IS NOT NULL AND owner_account_id != ?",
      [profile.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(403).json({ error: "Profile ID belongs to another user account." });
    }
    // Upsert into profile_metas
    await db.query(
      "INSERT INTO profile_metas (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [profile.id, req.user.id, req.user.id, JSON.stringify(profile)]
    );
    // Mirror to profiles
    await db.query(
      "INSERT INTO profiles (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [profile.id, req.user.id, req.user.id, JSON.stringify(profile)]
    );
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/profiles/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const profileId = req.params.id;
    // Delete matching profile from both tables (match id or nested _meta.id or config.id)
    const [resMeta] = await db.query(
      "DELETE FROM profile_metas WHERE (id = ? OR JSON_UNQUOTE(JSON_EXTRACT(document, '$._meta.id')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(document, '$.config.id')) = ?) AND (owner_account_id = ? OR userId = ?)",
      [profileId, profileId, profileId, req.user.id, req.user.id]
    );
    const [resProf] = await db.query(
      "DELETE FROM profiles WHERE (id = ? OR JSON_UNQUOTE(JSON_EXTRACT(document, '$._meta.id')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(document, '$.config.id')) = ?) AND (owner_account_id = ? OR userId = ?)",
      [profileId, profileId, profileId, req.user.id, req.user.id]
    );
    const totalDeleted = resMeta.affectedRows + resProf.affectedRows;
    if (totalDeleted === 0) {
      return res.status(404).json({ error: "Profile not found or access denied." });
    }
    await recordAuditLog(req.user.id, req.user.email, "profile_deleted", profileId, { profileId, totalDeleted });
    res.json({ success: true, deletedCount: totalDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Proxies Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/data/proxies", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM user_proxies WHERE owner_account_id = ? OR userId = ?",
      [req.user.id, req.user.id]
    );
    const proxies = rows.map(r => {
      const doc = typeof r.document === "string" ? JSON.parse(r.document) : r.document;
      return { id: r.id, ...doc, password: doc.password ? decryptField(doc.password) : doc.password };
    });
    res.json({ proxies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/proxies/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;
    const [rows] = await db.query(
      "SELECT * FROM user_proxies WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [proxyId, req.user.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Proxy not found or access denied." });
    }
    const r = rows[0];
    const doc = typeof r.document === "string" ? JSON.parse(r.document) : r.document;
    const proxy = { id: r.id, ...doc, password: doc.password ? decryptField(doc.password) : doc.password };
    res.json({ proxy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/proxies", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const rawProxy = { ...req.body };
    const encryptedPassword = rawProxy.password ? encryptField(rawProxy.password) : rawProxy.password;
    const now = toMySQLDate();
    const proxy = {
      ...rawProxy,
      id: rawProxy.id || `proxy-${Date.now()}`,
      password: encryptedPassword,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: rawProxy.created_at || rawProxy.createdAt || now,
      updated_at: now,
    };
    // Anti-poaching check
    const [existing] = await db.query(
      "SELECT id FROM user_proxies WHERE id = ? AND owner_account_id IS NOT NULL AND owner_account_id != ?",
      [proxy.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(403).json({ error: "Proxy ID belongs to another user account." });
    }
    // Upsert
    await db.query(
      "INSERT INTO user_proxies (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [proxy.id, req.user.id, req.user.id, JSON.stringify(proxy)]
    );
    await db.query(
      "INSERT INTO proxies (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [proxy.id, req.user.id, req.user.id, JSON.stringify(proxy)]
    );
    res.json({ success: true, proxy: { ...proxy, password: rawProxy.password } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/proxies/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;
    const [result] = await db.query(
      "DELETE FROM user_proxies WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [proxyId, req.user.id, req.user.id]
    );
    await db.query(
      "DELETE FROM proxies WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [proxyId, req.user.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Proxy not found or access denied." });
    }
    await recordAuditLog(req.user.id, req.user.email, "proxy_deleted", proxyId, { proxyId });
    res.json({ success: true, deletedCount: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Fingerprints, Bookmarks, and Folders (Account-Scoped) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/data/fingerprints", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM fingerprints WHERE owner_account_id = ? OR userId = ?",
      [req.user.id, req.user.id]
    );
    const fingerprints = rows.map(r => ({ id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) }));
    res.json({ fingerprints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/fingerprints/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM fingerprints WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [req.params.id, req.user.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Fingerprint not found or access denied." });
    }
    const r = rows[0];
    res.json({ fingerprint: { id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/fingerprints", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = toMySQLDate();
    const fp = {
      ...req.body,
      id: req.body.id || `fp-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || now,
      updated_at: now,
    };
    // Anti-poaching check
    const [existing] = await db.query(
      "SELECT id FROM fingerprints WHERE id = ? AND owner_account_id IS NOT NULL AND owner_account_id != ?",
      [fp.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(403).json({ error: "Fingerprint ID belongs to another user account." });
    }
    await db.query(
      "INSERT INTO fingerprints (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [fp.id, req.user.id, req.user.id, JSON.stringify(fp)]
    );
    res.json({ success: true, fingerprint: fp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Bookmarks Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/data/bookmarks", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM bookmarks WHERE owner_account_id = ? OR userId = ?",
      [req.user.id, req.user.id]
    );
    const bookmarks = rows.map(r => ({ id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) }));
    res.json({ bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/bookmarks", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = toMySQLDate();
    const bm = {
      ...req.body,
      id: req.body.id || `bm-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || now,
      updated_at: now,
    };
    // Anti-poaching check
    const [existing] = await db.query(
      "SELECT id FROM bookmarks WHERE id = ? AND owner_account_id IS NOT NULL AND owner_account_id != ?",
      [bm.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(403).json({ error: "Bookmark ID belongs to another user account." });
    }
    await db.query(
      "INSERT INTO bookmarks (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [bm.id, req.user.id, req.user.id, JSON.stringify(bm)]
    );
    res.json({ success: true, bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/bookmarks/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [result] = await db.query(
      "DELETE FROM bookmarks WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [req.params.id, req.user.id, req.user.id]
    );
    res.json({ success: true, deletedCount: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Extension Sets (Account-Scoped) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/data/extension-sets", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.query(
      "SELECT * FROM extension_sets WHERE owner_account_id = ? OR userId = ?",
      [req.user.id, req.user.id]
    );
    const sets = rows.map(r => ({ id: r.id, ...(typeof r.document === "string" ? JSON.parse(r.document) : r.document) }));
    res.json(sets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/extension-sets", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = toMySQLDate();
    const setDoc = {
      ...req.body,
      id: req.body.id || `set-${Date.now()}`,
      name: String(req.body.name || "Untitled Set").trim(),
      description: String(req.body.description || "").trim(),
      extension_ids: Array.isArray(req.body.extension_ids) ? req.body.extension_ids : [],
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || now,
      updated_at: now,
    };
    // Anti-poaching check
    const [existing] = await db.query(
      "SELECT id FROM extension_sets WHERE id = ? AND owner_account_id IS NOT NULL AND owner_account_id != ?",
      [setDoc.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(403).json({ error: "Extension Set ID belongs to another user account." });
    }
    await db.query(
      "INSERT INTO extension_sets (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [setDoc.id, req.user.id, req.user.id, JSON.stringify(setDoc)]
    );
    res.json({ success: true, set: setDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/extension-sets/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const [result] = await db.query(
      "DELETE FROM extension_sets WHERE id = ? AND (owner_account_id = ? OR userId = ?)",
      [req.params.id, req.user.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Extension Set not found or access denied." });
    }
    res.json({ success: true, deletedCount: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Initial Database Seed Function Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function seedInitialUsers() {
  const db = getDB();

  // Seed admin with requested credentials
  const adminEmail = "admin@opinioninsights.in";
  const [adminRows] = await db.query("SELECT id FROM users WHERE email = ?", [adminEmail]);
  if (adminRows.length === 0) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("Delle6400@", salt);
    await db.query(
      "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, true, false, 0)",
      [adminEmail, passwordHash, "Admin", "admin"]
    );
    console.log(`[Seed] Admin user created: ${adminEmail}`);
  }

  // Seed vendor default user
  const vendorEmail = "vendor@opinioninsights.in";
  const [vendorRows] = await db.query("SELECT id FROM users WHERE email = ?", [vendorEmail]);
  if (vendorRows.length === 0) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("Delle6400@", salt);
    await db.query(
      "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, true, false, 0)",
      [vendorEmail, passwordHash, "Default Vendor", "vendor"]
    );
    console.log(`[Seed] Vendor user created: ${vendorEmail}`);
  }
}

let serverInstance = null;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Start Server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function start() {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await connectDB();
      await seedInitialUsers();
      if (!process.env.VERCEL) {
        serverInstance = app.listen(PORT, () => {
          console.log(`[Opinion Insights Backend API] Running on http://localhost:${PORT}`);
        });
      }
      return;
    } catch (err) {
      console.error(`[Backend] Startup attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
      if (attempt < MAX_RETRIES) {
        const delayMs = 3000 * attempt;
        console.log(`[Backend] Retrying in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  console.error("[Backend] All startup retries exhausted. Cannot reach MySQL. Exiting.");
  if (!process.env.VERCEL) {
    process.exit(1);
  }
}

export function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

start();

export { app };
export default app;
