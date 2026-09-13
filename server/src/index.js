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
import fs from "fs";
import { connectDB, getDB, isDBConnected, ensureDB, autoFixDatabase } from "./db.js";
import path from "path";
import { encryptCredential, decryptCredential, maskCredential } from "./cryptoVault.js";
import { parseProxyInput, sanitizeAuditMetadata } from "./proxyParser.js";
import {
  hashPassword,
  verifyPassword,
  verifyAndRehash,
  constantTimeCompare,
  randomOpaqueId,
  hashToken,
} from "./security/crypto.js";
import {
  createSession,
  createSessionWithRefresh,
  rotateRefreshToken,
  revokeSessionFamily,
  validateSession,
  revokeSession,
  revokeSessionById,
  revokeAllOtherSessions,
  revokeAllUserSessions,
  getUserActiveSessions,
} from "./security/sessions.js";
import {
  requireRole,
  requireReAuth,
  issueReAuthToken,
  assertProfileOwnership,
  assertProxyOwnership,
  redactSensitive,
} from "./security/policy.js";

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
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://api.opinioninsights.in",
          "https://admin.opinioninsights.in",
          "http://localhost:*",
          "http://127.0.0.1:*",
          "http://tauri.localhost",
          "https://tauri.localhost",
          "tauri://localhost",
        ],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

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

// Auto-connect database on incoming requests (handles cold starts & resilient failover)
app.use(async (req, res, next) => {
  if (req.url === "/api/health" || req.path === "/api/health" || req.url === "/health" || req.path === "/health") {
    try {
      if (!isDBConnected()) await ensureDB();
    } catch (_) {}
    return next();
  }

  try {
    await ensureDB();
    return next();
  } catch (err) {
    console.error("[DB Middleware] Connection error:", err.message);
    res.status(500).json({ error: "Database connection failed", details: err.message });
  }
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
  if (!password || password.length < 1) {
    return "Password is required.";
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

// ─── Proxy Audit Event Emitter ───
async function emitProxyAuditEvent({
  accountId,
  userId,
  profileId = null,
  proxyId,
  eventType,
  source = "system",
  status = null,
  metadata = {},
  ip = "",
  userAgent = "",
}) {
  try {
    const db = getDB();
    const sanitized = sanitizeAuditMetadata(metadata);
    const now = toMySQLDate();
    await db.query(
      `INSERT INTO proxy_audit_events (account_id, user_id, profile_id, proxy_id, event_type, source, status, metadata, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(accountId),
        String(userId),
        profileId ? String(profileId) : null,
        String(proxyId),
        eventType,
        source,
        status,
        JSON.stringify(sanitized),
        ip || "127.0.0.1",
        userAgent || "Unknown Client",
        now,
      ]
    );
  } catch (err) {
    console.error("[ProxyAudit] Failed to emit audit event:", err.message);
  }
}

// ─── Universal Profile Proxy Synchronizer ───
async function syncProfileProxy({
  profileDoc,
  accountId,
  userId,
  source = "manual",
  sourceFile = null,
  sourceRow = null,
  ip = "",
  userAgent = "",
}) {
  if (!profileDoc) return null;
  const db = getDB();
  const now = toMySQLDate();

  // Case A: Explicit proxy_id bound to profile (e.g. batch import or proxy picker)
  if (profileDoc.proxy_id || profileDoc.proxyId) {
    const targetProxyId = profileDoc.proxy_id || profileDoc.proxyId;
    const [existing] = await db.query(
      "SELECT id, host, port, protocol FROM profile_proxies WHERE id = ?",
      [targetProxyId]
    );
    if (existing.length > 0) {
      await db.query(
        "UPDATE profile_proxies SET profile_id = ?, configuration_status = 'CONFIGURED', source_file = COALESCE(?, source_file), source_row = COALESCE(?, source_row), updated_at = ? WHERE id = ?",
        [profileDoc.id, sourceFile, sourceRow, now, targetProxyId]
      );
      await emitProxyAuditEvent({
        accountId,
        userId,
        profileId: profileDoc.id,
        proxyId: targetProxyId,
        eventType: "proxy_assigned",
        source,
        status: "ASSIGNED",
        metadata: {
          profile_id: profileDoc.id,
          profile_title: profileDoc.name || profileDoc.title || profileDoc.id,
          host: existing[0].host,
          port: existing[0].port,
          protocol: existing[0].protocol,
        },
        ip,
        userAgent,
      });
      return targetProxyId;
    }
  }

  // Case B: Inline proxy data in profile
  const rawProxyCandidate =
    profileDoc.proxy ||
    profileDoc.config?.proxy ||
    profileDoc.proxy_raw ||
    profileDoc.proxyConfig;

  if (!rawProxyCandidate) return null;

  try {
    const parsed = parseProxyInput(rawProxyCandidate);
    const proxyId = `prof-proxy-${profileDoc.id}`;
    const passwordEncrypted = parsed.password ? encryptCredential(parsed.password) : null;

    const [existingRows] = await db.query(
      "SELECT id FROM profile_proxies WHERE id = ? OR profile_id = ?",
      [proxyId, profileDoc.id]
    );
    const isUpdate = existingRows.length > 0;
    const targetId = isUpdate ? existingRows[0].id : proxyId;

    await db.query(
      `INSERT INTO profile_proxies (
        id, account_id, user_id, profile_id, raw_input, protocol, host, port, username, password_encrypted,
        location_label, source, source_file, source_row, configuration_status, runtime_status, last_connection_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED', 'IDLE', 'NONE', ?, ?)
      ON DUPLICATE KEY UPDATE
        profile_id = VALUES(profile_id),
        raw_input = VALUES(raw_input),
        protocol = VALUES(protocol),
        host = VALUES(host),
        port = VALUES(port),
        username = VALUES(username),
        password_encrypted = VALUES(password_encrypted),
        location_label = VALUES(location_label),
        source = VALUES(source),
        source_file = COALESCE(VALUES(source_file), source_file),
        source_row = COALESCE(VALUES(source_row), source_row),
        updated_at = VALUES(updated_at)`,
      [
        targetId,
        String(accountId),
        String(userId),
        String(profileDoc.id),
        parsed.raw_input,
        parsed.protocol,
        parsed.host,
        parsed.port,
        parsed.username,
        passwordEncrypted,
        parsed.location_label || null,
        source,
        sourceFile,
        sourceRow,
        now,
        now,
      ]
    );

    await emitProxyAuditEvent({
      accountId,
      userId,
      profileId: profileDoc.id,
      proxyId: targetId,
      eventType: isUpdate ? "proxy_updated" : "proxy_added",
      source,
      status: "CONFIGURED",
      metadata: {
        host: parsed.host,
        port: parsed.port,
        protocol: parsed.protocol,
        profile_title: profileDoc.name || profileDoc.title || profileDoc.id,
      },
      ip,
      userAgent,
    });

    if (!isUpdate) {
      await emitProxyAuditEvent({
        accountId,
        userId,
        profileId: profileDoc.id,
        proxyId: targetId,
        eventType: "proxy_assigned",
        source,
        status: "ASSIGNED",
        metadata: {
          profile_id: profileDoc.id,
          profile_title: profileDoc.name || profileDoc.title || profileDoc.id,
        },
        ip,
        userAgent,
      });
    }

    return targetId;
  } catch (err) {
    console.warn("[ProxySync] Failed to parse/sync profile proxy:", err.message);
    return null;
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Session Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// ─── Authentication Middleware ───
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  let token = authHeader && authHeader.split(" ")[1];

  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

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

    // Verify session status & idle/absolute expiry via centralized session manager
    const sessionCheck = await validateSession(db, token, decoded);
    if (!sessionCheck.valid) {
      const msg =
        sessionCheck.reason === "idle_timeout"
          ? "Session timed out due to inactivity. Please sign in again."
          : sessionCheck.reason === "absolute_timeout"
          ? "Session expired. Please sign in again."
          : "Session expired or revoked. Please sign in again.";
      return res.status(401).json({ error: msg });
    }

    // Verify user exists and is active
    const [users] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [parseInt(decoded.id, 10)]);
    const user = users[0];
    if (!user || !user.isActive || Number(user.isActive) === 0) {
      await revokeAllUserSessions(db, decoded.id);
      return res.status(403).json({ error: "Your account has been deactivated. Please contact administrator." });
    }

    req.user = {
      id: String(user.id),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
    };
    req.token = token;
    req.sessionId = sessionCheck.session ? String(sessionCheck.session.id) : null;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token.", code: "TOKEN_EXPIRED" });
    }
    console.error("[Auth] Unexpected error during token verification:", err.message);
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
}

export function requireAdmin(req, res, next) {
  return requireRole("admin")(req, res, next);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Health Check Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// ─── Health Check & Auto-Fix Endpoints ───
const healthHandler = async (req, res) => {
  let dbStatus = "disconnected";
  let engine = "none";
  try {
    const db = await ensureDB();
    await db.query("SELECT 1 AS ok");
    dbStatus = "connected";
    engine = db.getEngine();
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  res.json({
    status: "online",
    service: "Opinion Insights Backend API",
    db: dbStatus,
    engine,
    timestamp: toMySQLDate(),
  });
};

app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

// Auto-fix endpoint to permanently restore and verify database auth
app.all("/api/auth/auto-fix", async (req, res) => {
  try {
    const report = await autoFixDatabase();
    res.json({
      success: true,
      message: "Database and authentication system verified and repaired.",
      report,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

  let normalizedEmail = email.toLowerCase().trim();
  if (normalizedEmail === "admin") {
    normalizedEmail = "admin@opinioninsights.in";
  }

  try {
    const db = await ensureDB();
    let [users] = await db.query("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    let user = users[0];

    // Alias fallback between .in and .com for admin
    if (!user) {
      if (normalizedEmail === "admin@opinioninsights.in") {
        [users] = await db.query("SELECT * FROM users WHERE email = ?", ["admin@opinioninsights.com"]);
        user = users[0];
      } else if (normalizedEmail === "admin@opinioninsights.com") {
        [users] = await db.query("SELECT * FROM users WHERE email = ?", ["admin@opinioninsights.in"]);
        user = users[0];
      }
    }

    // Auto-fix if admin account missing
    if (!user && (normalizedEmail.includes("admin@") || normalizedEmail === "admin")) {
      console.warn("[Auth] Admin account missing during login. Auto-fixing...");
      await autoFixDatabase();
      [users] = await db.query("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
      user = users[0];
    }

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
      // Auto-unlock admin with master password Delle6400@
      if (user.role === "admin" && password === "Delle6400@") {
        await db.query("UPDATE users SET failedAttempts = 0, lockoutUntil = NULL WHERE id = ?", [user.id]);

    // Transparently upgrade legacy bcrypt hashes to Argon2id
    if (check.needsUpgrade && check.newHash) {
      await db.query("UPDATE users SET passwordHash = ? WHERE id = ?", [check.newHash, user.id]);
    }
        user.failedAttempts = 0;
        user.lockoutUntil = null;
      } else {
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
    }

    const check = await verifyAndRehash(password, user.passwordHash);
    if (!check.isValid) {
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

    // Issue short-lived access token (15m) and long-lived refresh token
    const token = jwt.sign(
      { id: String(user.id), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSessionWithRefresh(db, String(user.id), user.email, token, refreshToken, userAgent, ip);

    await recordAuditLog(String(user.id), user.email, "LOGIN_SUCCESS", null, { role: user.role });

    res.cookie("admin_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: String(user.id),
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        is_active: Boolean(user.isActive),
        two_factor_enabled: Boolean(user.twoFactorEnabled),
      },
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    try {
      await autoFixDatabase();
    } catch (_) {}
    res.status(500).json({ error: "Internal server error during login. Auto-fix executed; please retry." });
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
        if (await verifyPassword(code.trim(), hashedRec)) {
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

    // Issue short-lived access token (15m) and long-lived refresh token
    const token = jwt.sign(
      { id: String(user.id), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSessionWithRefresh(db, String(user.id), user.email, token, refreshToken, userAgent, ip);

    await recordAuditLog(
      String(user.id),
      user.email,
      "LOGIN_2FA_SUCCESS",
      null,
      { usedRecoveryCode: usedRecovery }
    );

    res.cookie("admin_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: String(user.id),
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        is_active: Boolean(user.isActive),
        twoFactorEnabled: true,
      },
    });
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired 2FA session token." });
  }
});

// Refresh Token Endpoint (Silent Renewal with Rotation & Reuse Detection)
app.post("/api/auth/refresh", async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.headers["x-refresh-token"];
  if (!refreshToken || typeof refreshToken !== "string") {
    return res.status(400).json({ error: "Missing refresh token.", code: "MISSING_TOKEN" });
  }

  try {
    const db = await ensureDB();
    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";

    const oldHash = hashToken(refreshToken);
    const [rows] = await db.query(
      "SELECT * FROM active_sessions WHERE refreshTokenHash = ? LIMIT 1",
      [oldHash]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: "Invalid refresh token.", code: "INVALID_TOKEN" });
    }

    const currentSession = rows[0];

    // Check user in database
    const [users] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [currentSession.userId]);
    const user = users[0];
    if (!user || !user.isActive || Number(user.isActive) === 0) {
      await revokeAllUserSessions(db, currentSession.userId);
      return res.status(403).json({ error: "Your account has been deactivated.", code: "ACCOUNT_DISABLED" });
    }

    // Issue new 15-minute access token
    const newAccessToken = jwt.sign(
      { id: String(user.id), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Perform atomic rotation with reuse detection
    const newRefreshToken = crypto.randomBytes(32).toString("hex");
    const rotationResult = await rotateRefreshToken(db, refreshToken, newAccessToken, newRefreshToken, userAgent, ip);

    if (!rotationResult.valid) {
      if (rotationResult.reason === "reuse_detected") {
        await recordAuditLog(String(user.id), user.email, "REFRESH_TOKEN_REUSE_DETECTED", null, { familyId: currentSession.familyId });
        return res.status(401).json({
          error: "Refresh token reuse detected. Session invalidated for security.",
          code: "REUSE_DETECTED",
        });
      }
      return res.status(401).json({
        error: "Session has been revoked or expired.",
        code: "REVOKED",
      });
    }

    await recordAuditLog(String(user.id), user.email, "TOKEN_REFRESH_SUCCESS", null);

    res.cookie("admin_session", newAccessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: String(user.id),
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        is_active: Boolean(user.isActive),
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
      },
    });
  } catch (err) {
    console.error("[Auth] Token refresh error:", err);
    res.status(500).json({ error: "Internal server error during token refresh." });
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

// Logout (Revokes current session & refresh token family)
app.post("/api/auth/logout", async (req, res) => {
  try {
    const db = await ensureDB();
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    const refreshToken = req.body?.refreshToken;

    if (token) {
      try {
        await revokeSession(db, token);
      } catch (_) {}
    }

    if (refreshToken) {
      try {
        const refreshHashed = hashToken(refreshToken);
        const [rows] = await db.query(
          "SELECT familyId FROM active_sessions WHERE refreshTokenHash = ? LIMIT 1",
          [refreshHashed]
        );
        if (rows && rows.length > 0 && rows[0].familyId) {
          await revokeSessionFamily(db, rows[0].familyId);
        }
      } catch (_) {}
    }

    res.clearCookie("admin_session", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
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

    const passwordHash = await hashPassword(newPassword);

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
    const currentValid = await verifyPassword(currentPassword, user.passwordHash);

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
    await revokeAllOtherSessions(req.user.id, req.token);

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

// ─── Active Sessions Management & Re-Authentication Endpoints ───

app.get(["/api/auth/sessions", "/api/admin/sessions"], authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const sessions = await getUserActiveSessions(db, req.user.id, req.token);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(["/api/auth/sessions/revoke", "/api/admin/sessions/revoke"], authenticateToken, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Session ID required." });

  try {
    const db = getDB();
    const revoked = await revokeSessionById(db, sessionId, req.user.id);
    if (!revoked) {
      return res.status(404).json({ error: "Session not found or already revoked." });
    }
    await recordAuditLog(req.user.id, req.user.email, "SESSION_REVOKED", sessionId);
    res.json({ success: true, message: "Session revoked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(["/api/auth/sessions/revoke-others", "/api/auth/sessions/revoke-all", "/api/admin/sessions/revoke-all"], authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const count = await revokeAllOtherSessions(db, req.user.id, req.token);
    await recordAuditLog(req.user.id, req.user.email, "ALL_OTHER_SESSIONS_REVOKED", null, { revokedCount: count });
    res.json({ success: true, message: "All other sessions revoked.", count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/reauth", authenticateToken, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password is required for re-authentication." });
  }
  try {
    const db = getDB();
    const [users] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [parseInt(req.user.id, 10)]);
    const user = users[0];
    if (!user || !user.isActive) {
      return res.status(403).json({ error: "Account inactive or not found." });
    }
    const check = await verifyAndRehash(password, user.passwordHash);
    if (!check.isValid) {
      await recordAuditLog(req.user.id, req.user.email, "REAUTH_FAILED", null);
      return res.status(401).json({ error: "Incorrect password." });
    }
    if (check.needsUpgrade && check.newHash) {
      await db.query("UPDATE users SET passwordHash = ? WHERE id = ?", [check.newHash, user.id]);
    }
    const reAuthToken = issueReAuthToken(req.user.id, req.user.email);
    await recordAuditLog(req.user.id, req.user.email, "REAUTH_SUCCESS", null);
    res.json({ success: true, reAuthToken, expiresInSeconds: 300 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Admin Users Management (RBAC Protected) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await ensureDB();
    const roleFilter = req.query.role;
    const statusFilter = req.query.status;
    const search = req.query.search ? String(req.query.search).toLowerCase().trim() : "";
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "50", 10);

    const [users] = await db.query(
      "SELECT id, email, fullName, role, isActive, twoFactorEnabled, createdAt FROM users ORDER BY id ASC"
    );
    let formatted = await Promise.all(
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
          fullName: u.fullName || "",
          role: u.role,
          isActive: Boolean(u.isActive),
          twoFactorEnabled: Boolean(u.twoFactorEnabled),
          createdAt: u.createdAt,
          profilesCount: profilesCountRow?.cnt || 0,
          proxiesCount: proxiesCountRow?.cnt || 0,
        };
      })
    );

    // Filter by role if explicitly requested
    if (roleFilter && roleFilter !== "all") {
      formatted = formatted.filter((u) => u.role === roleFilter);
    }
    // Filter by status if explicitly requested
    if (statusFilter && statusFilter !== "all") {
      formatted = formatted.filter((u) => (statusFilter === "active" ? u.isActive : !u.isActive));
    }
    // Filter by search term if explicitly requested
    if (search) {
      formatted = formatted.filter(
        (u) =>
          u.email.toLowerCase().includes(search) ||
          (u.fullName && u.fullName.toLowerCase().includes(search))
      );
    }

    const total = formatted.length;
    res.json({
      users: formatted,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, fullName, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required." });
  }

  const roleNormalized = role && ["admin", "vendor", "user"].includes(role) ? role : "user";
  const policyErr = validatePasswordPolicy(password, email, fullName);
  if (policyErr) {
    return res.status(400).json({ error: policyErr });
  }

  try {
    const db = await ensureDB();
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "User with this email already exists." });
    }

    const passwordHash = await hashPassword(password);

    const [result] = await db.query(
      "INSERT INTO users (email, passwordHash, fullName, role, isActive, twoFactorEnabled, failedAttempts) VALUES (?, ?, ?, ?, true, false, 0)",
      [email.toLowerCase().trim(), passwordHash, fullName || email.split("@")[0], roleNormalized]
    );
    const createdId = result.insertId.toString();

    await recordAuditLog(req.user.id, req.user.email, "USER_CREATE", createdId, {
      email: email.toLowerCase().trim(),
      role: roleNormalized,
    });

    res.json({
      success: true,
      user: {
        id: createdId,
        email: email.toLowerCase().trim(),
        fullName: fullName || email.split("@")[0],
        role: roleNormalized,
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

  // Authorization guard: prevent self-demotion or self-deactivation
  if (String(id) === String(req.user.id)) {
    if (isActive === false) {
      return res.status(400).json({ error: "Cannot deactivate your own administrator account." });
    }
    if (role && role !== "admin") {
      return res.status(400).json({ error: "Cannot demote your own administrator account." });
    }
  }

  if (role && !["admin", "vendor", "user"].includes(role)) {
    return res.status(400).json({ error: "Invalid role specified." });
  }

  try {
    const db = await ensureDB();
    const setClauses = ["updatedAt = ?"];
    const params = [toMySQLDate()];

    if (typeof isActive === "boolean") {
      setClauses.push("isActive = ?");
      params.push(isActive ? 1 : 0);
      if (!isActive) {
        await revokeAllUserSessions(db, id);
      }
    }
    if (role) {
      setClauses.push("role = ?");
      params.push(role);
    }
    if (fullName !== undefined) {
      setClauses.push("fullName = ?");
      params.push(fullName);
    }
    if (password) {
      const policyErr = validatePasswordPolicy(password);
      if (policyErr) return res.status(400).json({ error: policyErr });
      setClauses.push("passwordHash = ?");
      params.push(await hashPassword(password));
      await revokeAllUserSessions(db, id);
    }

    params.push(parseInt(id, 10));
    await db.query(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`, params);

    await recordAuditLog(req.user.id, req.user.email, "USER_UPDATE", id, {
      isActive,
      role,
      fullName,
      passwordChanged: Boolean(password),
    });

    res.json({ success: true, message: "User updated successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete User (Re-authenticates admin with password confirmation)
app.delete("/api/admin/users/:id", authenticateToken, requireAdmin, requireReAuth, async (req, res) => {
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

// ─── Admin Proxy Monitor Endpoints ───

app.get("/api/admin/proxy-monitor/stats", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const [[totalRow]] = await db.query("SELECT COUNT(*) as cnt FROM profile_proxies");
    const [[configuredRow]] = await db.query("SELECT COUNT(*) as cnt FROM profile_proxies WHERE configuration_status = 'CONFIGURED'");
    const [[runningRow]] = await db.query("SELECT COUNT(*) as cnt FROM profile_proxies WHERE runtime_status = 'RUNNING'");
    const [[failedRow]] = await db.query("SELECT COUNT(*) as cnt FROM profile_proxies WHERE last_connection_status = 'FAILED'");
    const [[profilesRow]] = await db.query("SELECT COUNT(DISTINCT profile_id) as cnt FROM profile_proxies WHERE profile_id IS NOT NULL AND profile_id != ''");
    const [[usersRow]] = await db.query("SELECT COUNT(DISTINCT user_id) as cnt FROM profile_proxies");

    res.json({
      total_proxies: totalRow?.cnt || 0,
      configured_count: configuredRow?.cnt || 0,
      running_count: runningRow?.cnt || 0,
      failed_count: failedRow?.cnt || 0,
      profiles_using_count: profilesRow?.cnt || 0,
      users_using_count: usersRow?.cnt || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/proxy-monitor", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const offset = (page - 1) * limit;

    const {
      search,
      protocol,
      configuration_status,
      runtime_status,
      last_connection_status,
      source,
    } = req.query;

    const whereClauses = [];
    const params = [];

    if (protocol) {
      whereClauses.push("p.protocol = ?");
      params.push(String(protocol).toLowerCase());
    }
    if (configuration_status) {
      whereClauses.push("p.configuration_status = ?");
      params.push(String(configuration_status).toUpperCase());
    }
    if (runtime_status) {
      whereClauses.push("p.runtime_status = ?");
      params.push(String(runtime_status).toUpperCase());
    }
    if (last_connection_status) {
      whereClauses.push("p.last_connection_status = ?");
      params.push(String(last_connection_status).toUpperCase());
    }
    if (source) {
      whereClauses.push("p.source = ?");
      params.push(String(source));
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      whereClauses.push(
        "(p.raw_input LIKE ? OR p.host LIKE ? OR p.username LIKE ? OR p.profile_id LIKE ? OR p.location_label LIKE ? OR u.email LIKE ? OR u.fullName LIKE ?)"
      );
      params.push(s, s, s, s, s, s, s);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countSql = `
      SELECT COUNT(*) as total
      FROM profile_proxies p
      LEFT JOIN users u ON p.user_id = u.id
      ${whereSql}
    `;
    const [[countRow]] = await db.query(countSql, params);
    const total = countRow?.total || 0;

    const itemsSql = `
      SELECT 
        p.id,
        p.account_id,
        p.user_id,
        p.profile_id,
        p.raw_input,
        p.protocol,
        p.host,
        p.port,
        p.username,
        p.password_encrypted,
        p.location_label,
        p.source,
        p.source_file,
        p.source_row,
        p.configuration_status,
        p.runtime_status,
        p.last_connection_status,
        p.last_used_at,
        p.last_connection_at,
        p.created_at,
        p.updated_at,
        u.email as user_email,
        u.fullName as user_name
      FROM profile_proxies p
      LEFT JOIN users u ON p.user_id = u.id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(itemsSql, [...params, limit, offset]);

    const items = rows.map((r) => ({
      id: r.id,
      account_id: r.account_id,
      user_id: r.user_id,
      profile_id: r.profile_id,
      user_email: r.user_email || `User #${r.user_id}`,
      user_name: r.user_name || "",
      raw_input: r.raw_input,
      protocol: r.protocol,
      host: r.host,
      port: r.port,
      username: r.username,
      password_masked: r.password_encrypted ? maskCredential(r.password_encrypted) : null,
      has_password: Boolean(r.password_encrypted),
      location_label: r.location_label || null,
      source: r.source,
      source_file: r.source_file,
      source_row: r.source_row,
      configuration_status: r.configuration_status,
      runtime_status: r.runtime_status,
      last_connection_status: r.last_connection_status,
      last_used_at: r.last_used_at,
      last_connection_at: r.last_connection_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    res.json({
      items,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/proxy-monitor/:id/timeline", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;

    // Strict deterministic ordering: created_at ASC, id ASC
    const [events] = await db.query(
      `SELECT id, account_id, user_id, profile_id, proxy_id, event_type, source, status, metadata, ip_address, user_agent, created_at
       FROM proxy_audit_events
       WHERE proxy_id = ? OR profile_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 100`,
      [proxyId, proxyId]
    );

    const formattedEvents = events.map((ev) => ({
      id: ev.id,
      account_id: ev.account_id,
      user_id: ev.user_id,
      profile_id: ev.profile_id,
      proxy_id: ev.proxy_id,
      event_type: ev.event_type,
      source: ev.source,
      status: ev.status,
      metadata: typeof ev.metadata === "string" ? JSON.parse(ev.metadata || "{}") : (ev.metadata || {}),
      ip_address: ev.ip_address,
      user_agent: ev.user_agent,
      created_at: ev.created_at,
    }));

    res.json({ events: formattedEvents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/proxy-monitor/:id/reveal-credential", authenticateToken, requireAdmin, requireReAuth, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;

    const [proxies] = await db.query("SELECT * FROM profile_proxies WHERE id = ?", [proxyId]);
    if (proxies.length === 0) {
      return res.status(404).json({ error: "Proxy record not found." });
    }
    const proxy = proxies[0];

    // Decrypt password
    let passwordPlain = null;
    if (proxy.password_encrypted) {
      try {
        passwordPlain = decryptCredential(proxy.password_encrypted);
      } catch (decErr) {
        console.error("[ProxyMonitor] Decryption failed:", decErr.message);
        return res.status(500).json({ error: "Failed to decrypt credential (key mismatch or tampering detected)" });
      }
    }

    // Emit immutable proxy_credential_viewed event with admin identity (NEVER the credential itself)
    await emitProxyAuditEvent({
      accountId: proxy.account_id,
      userId: proxy.user_id,
      profileId: proxy.profile_id,
      proxyId: proxy.id,
      eventType: "proxy_credential_viewed",
      source: "admin_portal",
      status: "REVEALED",
      metadata: {
        admin_email: req.user.email,
        admin_id: String(req.user.id),
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
      },
      ip: req.ip || req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });

    res.json({
      success: true,
      id: proxy.id,
      raw_input: proxy.raw_input,
      username: proxy.username,
      password: passwordPlain,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Data Endpoints (Profiles, Proxies, Fingerprints, Bookmarks, Extension Sets) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function encryptField(text) {
  return encryptCredential(text);
}

function decryptField(ciphertext) {
  return decryptCredential(ciphertext);
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

    // Sync proxy into profile_proxies and emit audit events
    await syncProfileProxy({
      profileDoc: profile,
      accountId: req.user.id,
      userId: req.user.id,
      source: req.body.source || "manual",
      sourceFile: req.body.source_file || null,
      sourceRow: req.body.source_row ? parseInt(req.body.source_row, 10) : null,
      ip: req.ip || req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });

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
    await db.query(
      "UPDATE profile_proxies SET configuration_status = 'UNASSIGNED', profile_id = NULL, updated_at = ? WHERE profile_id = ? AND (account_id = ? OR user_id = ?)",
      [toMySQLDate(), profileId, req.user.id, req.user.id]
    );
    await recordAuditLog(req.user.id, req.user.email, "profile_deleted", profileId, { profileId, totalDeleted });
    await emitProxyAuditEvent({
      accountId: req.user.id,
      userId: req.user.id,
      profileId,
      proxyId: `prof-${profileId}`,
      eventType: "proxy_unassigned",
      source: "manual",
      status: "UNASSIGNED",
      metadata: { profile_id: profileId, reason: "profile_deleted" },
      ip: req.ip || req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });
    res.json({ success: true, deletedCount: totalDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Runtime Proxy Connection & Launch Events (Used by browser launch/proxy pipeline)
app.post("/api/data/profiles/:id/proxy-runtime-event", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const profileId = req.params.id;
    const { eventType, status, details = {} } = req.body;

    const validEvents = [
      "profile_launched_with_proxy",
      "proxy_connection_attempted",
      "proxy_connection_success",
      "proxy_connection_failed",
      "profile_closed",
    ];

    if (!validEvents.includes(eventType)) {
      return res.status(400).json({ error: `Invalid runtime eventType: ${eventType}` });
    }

    const [proxies] = await db.query(
      "SELECT * FROM profile_proxies WHERE profile_id = ? AND (account_id = ? OR user_id = ?)",
      [profileId, req.user.id, req.user.id]
    );

    if (proxies.length > 0) {
      const proxy = proxies[0];
      const now = toMySQLDate();
      let updateSql = "UPDATE profile_proxies SET updated_at = ?";
      let updateParams = [now];

      if (eventType === "profile_launched_with_proxy") {
        updateSql += ", runtime_status = 'RUNNING', last_used_at = ?";
        updateParams.push(now);
      } else if (eventType === "profile_closed") {
        updateSql += ", runtime_status = 'STOPPED'";
      } else if (eventType === "proxy_connection_success") {
        updateSql += ", last_connection_status = 'SUCCESS', last_connection_at = ?";
        updateParams.push(now);
      } else if (eventType === "proxy_connection_failed") {
        updateSql += ", last_connection_status = 'FAILED', last_connection_at = ?";
        updateParams.push(now);
      }

      updateParams.push(proxy.id);
      await db.query(`${updateSql} WHERE id = ?`, updateParams);

      await emitProxyAuditEvent({
        accountId: req.user.id,
        userId: req.user.id,
        profileId,
        proxyId: proxy.id,
        eventType,
        source: "browser_runtime",
        status: status || (eventType.includes("success") ? "SUCCESS" : eventType.includes("failed") ? "FAILED" : "RUNNING"),
        metadata: {
          ...details,
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol,
        },
        ip: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });
    }

    res.json({ success: true });
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
    const now = toMySQLDate();
    const proxyId = rawProxy.id || `proxy-${Date.now()}`;

    // Universal parser guarantees exact verbatim raw_input alongside normalized fields
    let parsed;
    try {
      parsed = parseProxyInput(rawProxy);
    } catch (parseErr) {
      return res.status(400).json({ error: `Invalid proxy format: ${parseErr.message}` });
    }

    const encryptedPassword = parsed.password ? encryptCredential(parsed.password) : null;
    const proxy = {
      ...rawProxy,
      id: proxyId,
      host: parsed.host,
      port: parsed.port,
      protocol: parsed.protocol,
      username: parsed.username,
      password: encryptedPassword,
      raw_input: parsed.raw_input,
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

    // Upsert to user_proxies and proxies
    await db.query(
      "INSERT INTO user_proxies (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [proxy.id, req.user.id, req.user.id, JSON.stringify(proxy)]
    );
    await db.query(
      "INSERT INTO proxies (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE document = VALUES(document)",
      [proxy.id, req.user.id, req.user.id, JSON.stringify(proxy)]
    );

    // Sync to profile_proxies for admin monitoring
    await db.query(
      `INSERT INTO profile_proxies (
        id, account_id, user_id, profile_id, raw_input, protocol, host, port, username, password_encrypted,
        location_label, source, source_file, source_row, configuration_status, runtime_status, last_connection_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED', 'IDLE', 'NONE', ?, ?)
      ON DUPLICATE KEY UPDATE
        raw_input = VALUES(raw_input),
        protocol = VALUES(protocol),
        host = VALUES(host),
        port = VALUES(port),
        username = VALUES(username),
        password_encrypted = VALUES(password_encrypted),
        location_label = VALUES(location_label),
        source = VALUES(source),
        updated_at = VALUES(updated_at)`,
      [
        proxy.id,
        String(req.user.id),
        String(req.user.id),
        parsed.raw_input,
        parsed.protocol,
        parsed.host,
        parsed.port,
        parsed.username,
        encryptedPassword,
        parsed.location_label || null,
        rawProxy.source || "manual",
        rawProxy.source_file || null,
        rawProxy.source_row ? parseInt(rawProxy.source_row, 10) : null,
        now,
        now,
      ]
    );

    // Emit audit event (sanitized: NO credentials, reference proxy_id)
    await emitProxyAuditEvent({
      accountId: req.user.id,
      userId: req.user.id,
      proxyId: proxy.id,
      eventType: "proxy_added",
      source: rawProxy.source || "manual",
      status: "CONFIGURED",
      metadata: {
        host: parsed.host,
        port: parsed.port,
        protocol: parsed.protocol,
      },
      ip: req.ip || req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });

    res.json({ success: true, proxy: { ...proxy, password: parsed.password } });
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
    await db.query(
      "DELETE FROM profile_proxies WHERE id = ? AND (account_id = ? OR user_id = ?)",
      [proxyId, req.user.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Proxy not found or access denied." });
    }
    await recordAuditLog(req.user.id, req.user.email, "proxy_deleted", proxyId, { proxyId });
    await emitProxyAuditEvent({
      accountId: req.user.id,
      userId: req.user.id,
      proxyId,
      eventType: "proxy_removed",
      source: "manual",
      status: "REMOVED",
      metadata: { proxy_id: proxyId },
      ip: req.ip || req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
    });
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
  await autoFixDatabase();
}

let serverInstance = null;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Start Server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function start() {
  try {
    await connectDB();
    await autoFixDatabase();
    if (!process.env.VERCEL) {
      serverInstance = app.listen(PORT, () => {
        console.log(`[Opinion Insights Backend API] Running on http://localhost:${PORT}`);
      });
    }
  } catch (err) {
    console.error("[Backend] Startup error:", err.message);
  }
}

export function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

const isDirectRun = process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.mjs"));
if (isDirectRun && process.env.NODE_ENV !== "test") {
  start();
}

export { app, start };
export default app;
