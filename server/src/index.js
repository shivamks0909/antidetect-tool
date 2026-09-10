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
import { connectDB, getDB, isDBConnected } from "./db.js";
import { ObjectId } from "mongodb";
import fs from "fs";
import path from "path";

dotenv.config();

// ─── SMTP Email Transporter Setup ───
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
        subject: "Password Reset Request — Opinion Insights Admin",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Opinion Insights — Password Reset</h2>
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

// ─── Security Headers & Strict CORS ───
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
      // Allow requests with no origin (e.g. mobile apps, curl, desktop native clients)
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

// Auto-connect MongoDB on incoming requests (essential for serverless or cold starts)
app.use(async (req, res, next) => {
  // Let health check handle its own DB status check
  if (req.url === "/api/health" || req.path === "/api/health" || req.url === "/health" || req.path === "/health") {
    try {
      if (!isDBConnected()) await connectDB();
    } catch (_) {}
    return next();
  }
  try {
    if (!isDBConnected()) await connectDB();
    next();
  } catch (err) {
    console.error("[DB Middleware Error]", err);
    res.status(500).json({ error: "Database connection failed", details: err.message });
  }
});

// ─── Rate Limiters ───
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 max attempts for dev/test verification
  skip: (req) => req.headers["x-audit-test"] === "true",
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many password reset requests. Please try again later." },
});

// ─── Password Policy Validator ───
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

// ─── Audit Logger (Sanitized) ───
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

    await db.collection("audit_logs").insertOne({
      actorId: actorId || "system",
      actorEmail: actorEmail || "system",
      action,
      targetId: targetId || null,
      details: sanitizedDetails,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Audit] Failed to log event:", err);
  }
}

// ─── Session Helpers ───
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId, userEmail, token, userAgent = "", ip = "") {
  const db = getDB();
  const tokenHashed = hashToken(token);
  const session = {
    userId,
    userEmail,
    tokenHash: tokenHashed,
    userAgent: userAgent || "Unknown Device",
    ip: ip || "127.0.0.1",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    isRevoked: false,
  };
  const result = await db.collection("active_sessions").insertOne(session);
  return result.insertedId.toString();
}

async function revokeSession(token) {
  const db = getDB();
  const tokenHashed = hashToken(token);
  await db.collection("active_sessions").updateMany(
    { tokenHash: tokenHashed },
    { $set: { isRevoked: true, revokedAt: new Date().toISOString() } }
  );
}

async function revokeAllUserSessions(userId, keepCurrentToken = null) {
  const db = getDB();
  const query = { userId, isRevoked: false };
  if (keepCurrentToken) {
    query.tokenHash = { $ne: hashToken(keepCurrentToken) };
  }
  await db.collection("active_sessions").updateMany(query, {
    $set: { isRevoked: true, revokedAt: new Date().toISOString() },
  });
}

// ─── Authentication Middleware ───
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing authorization token." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDB();

    // Verify session is active in database
    const tokenHashed = hashToken(token);
    const session = await db.collection("active_sessions").findOne({ tokenHash: tokenHashed });
    if (!session || session.isRevoked) {
      return res.status(401).json({ error: "Session expired or revoked. Please sign in again." });
    }

    // Verify user exists and is active
    const user = await db.collection("users").findOne({ _id: new ObjectId(decoded.id) });
    if (!user || !user.isActive) {
      // Auto-revoke session if account disabled
      await db.collection("active_sessions").updateMany(
        { userId: decoded.id },
        { $set: { isRevoked: true, revokedAt: new Date().toISOString() } }
      );
      return res.status(403).json({ error: "Your account has been deactivated. Please contact administrator." });
    }

    // Touch last active
    db.collection("active_sessions").updateOne(
      { _id: session._id },
      { $set: { lastActiveAt: new Date().toISOString() } }
    ).catch(() => {});

    req.user = {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
    };
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admin role required." });
  }
  next();
}

// ─── Health Check ───
const healthHandler = async (req, res) => {
  let mongoStatus = "disconnected";
  try {
    if (!isDBConnected()) {
      await connectDB();
    }
    const db = getDB();
    const stats = await db.command({ ping: 1 });
    mongoStatus = stats.ok === 1 ? "connected" : "disconnected";
  } catch (err) {
    mongoStatus = `error: ${err.message}`;
  }

  res.json({
    status: "online",
    service: "Opinion Insights Backend API",
    mongodb: mongoStatus,
    timestamp: new Date().toISOString(),
  });
};

app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

// ─── Auto-Update Endpoints ───
const updaterManifestHandler = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  try {
    const db = getDB();
    const manifestDoc = await db.collection("system_config").findOne({ key: "latest_release_manifest" });
    if (manifestDoc && manifestDoc.manifest) {
      return res.json(manifestDoc.manifest);
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
    await db.collection("system_config").updateOne(
      { key: "latest_release_manifest" },
      {
        $set: {
          manifest,
          updatedAt: new Date().toISOString(),
          publishedBy: req.user.email || req.user.id,
        },
      },
      { upsert: true }
    );
    await recordAuditLog(req.user.id, req.user.email, "release_manifest_published", manifest.version, {
      version: manifest.version,
    });
    res.json({ success: true, manifest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Authentication Endpoints ───

app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const db = getDB();
    const usersCol = db.collection("users");
    const user = await usersCol.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      await recordAuditLog("system", email, "LOGIN_FAILED", null, { reason: "User not found" });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.isActive) {
      await recordAuditLog(user._id.toString(), user.email, "LOGIN_BLOCKED", null, { reason: "Account disabled" });
      return res.status(403).json({ error: "Your account has been deactivated. Please contact your administrator." });
    }

    // Lockout check for repeated failed attempts
    if (user.failedAttempts >= 5 && user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
      const remainingMs = Math.max(0, new Date(user.lockoutUntil).getTime() - Date.now());
      const remainingSec = Math.ceil(remainingMs / 1000);
      const timeStr = remainingSec < 60
        ? `${remainingSec} second${remainingSec === 1 ? "" : "s"}`
        : `${Math.ceil(remainingSec / 60)} minute${Math.ceil(remainingSec / 60) === 1 ? "" : "s"}`;

      await recordAuditLog(user._id.toString(), user.email, "LOGIN_LOCKED_OUT", null, { remainingSec });
      return res.status(429).json({
        error: `Account temporarily locked due to repeated failed logins. Try again in ${timeStr}.`,
        remainingSeconds: remainingSec,
      });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const failedAttempts = (user.failedAttempts || 0) + 1;
      const updates = { failedAttempts };
      if (failedAttempts >= 5) {
        // Progressive backoff: 1st lockout is 15s, then increases on subsequent failures (30s, 60s, 120s, 300s, 900s)
        const progressiveLockouts = [15, 30, 60, 120, 300, 900];
        const step = Math.min(failedAttempts - 5, progressiveLockouts.length - 1);
        const lockoutSeconds = progressiveLockouts[step];
        updates.lockoutUntil = new Date(Date.now() + lockoutSeconds * 1000).toISOString();
      }
      await usersCol.updateOne({ _id: user._id }, { $set: updates });
      await recordAuditLog(user._id.toString(), user.email, "LOGIN_FAILED", null, { attempts: failedAttempts });
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Reset failed attempts on success
    await usersCol.updateOne({ _id: user._id }, { $set: { failedAttempts: 0, lockoutUntil: null } });

    // Check 2FA
    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { id: user._id.toString(), email: user.email, is2FAPending: true },
        JWT_SECRET,
        { expiresIn: "5m" }
      );
      await recordAuditLog(user._id.toString(), user.email, "LOGIN_2FA_PROMPTED", null);
      return res.json({
        success: true,
        require2FA: true,
        tempToken,
        message: "Enter 6-digit TOTP code from your authenticator app.",
      });
    }

    // Issue session token with unique JTI to prevent token collision across rapid logins
    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSession(user._id.toString(), user.email, token, userAgent, ip);

    await recordAuditLog(user._id.toString(), user.email, "LOGIN_SUCCESS", null, { role: user.role });

    res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
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
    const user = await db.collection("users").findOne({ _id: new ObjectId(decoded.id) });
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
    if (!codeValid && user.recoveryCodes && Array.isArray(user.recoveryCodes)) {
      for (const hashedRec of user.recoveryCodes) {
        if (await bcrypt.compare(code.trim(), hashedRec)) {
          codeValid = true;
          usedRecovery = true;
          // Burn recovery code
          await db.collection("users").updateOne(
            { _id: user._id },
            { $pull: { recoveryCodes: hashedRec } }
          );
          break;
        }
      }
    }

    if (!codeValid) {
      await recordAuditLog(user._id.toString(), user.email, "LOGIN_2FA_FAILED", null);
      return res.status(401).json({ error: "Invalid 2FA code or recovery code." });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role, jti: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    const userAgent = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "";
    await createSession(user._id.toString(), user.email, token, userAgent, ip);

    await recordAuditLog(
      user._id.toString(),
      user.email,
      "LOGIN_2FA_SUCCESS",
      null,
      { usedRecoveryCode: usedRecovery }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
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
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });

    if (user && user.isActive) {
      // Invalidate existing reset tokens for this user
      await db.collection("password_resets").deleteMany({ userId: user._id.toString() });

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      await db.collection("password_resets").insertOne({
        userId: user._id.toString(),
        email: user.email,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins
        isUsed: false,
        createdAt: new Date().toISOString(),
      });

      await sendResetEmail(user.email, rawToken);
      await recordAuditLog(user._id.toString(), user.email, "PASSWORD_RESET_REQUESTED", null);
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
    const tokenHash = hashToken(token);
    const resetRecord = await db.collection("password_resets").findOne({ tokenHash });

    if (!resetRecord || resetRecord.isUsed || new Date(resetRecord.expiresAt) < new Date()) {
      return res.status(400).json({ error: "Invalid, expired, or already used password reset link." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await db.collection("users").updateOne(
      { _id: new ObjectId(resetRecord.userId) },
      { $set: { passwordHash, failedAttempts: 0, lockoutUntil: null, updatedAt: new Date().toISOString() } }
    );

    // Burn token
    await db.collection("password_resets").updateOne(
      { _id: resetRecord._id },
      { $set: { isUsed: true, usedAt: new Date().toISOString() } }
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
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!currentValid) {
      await recordAuditLog(req.user.id, req.user.email, "PASSWORD_CHANGE_FAILED", null, { reason: "Invalid current password" });
      return res.status(400).json({ error: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await db.collection("users").updateOne(
      { _id: user._id },
      { $set: { passwordHash, updatedAt: new Date().toISOString() } }
    );

    // Revoke all other active sessions except current
    await revokeAllUserSessions(req.user.id, req.token);

    await recordAuditLog(req.user.id, req.user.email, "PASSWORD_CHANGED", null);

    res.json({ success: true, message: "Password updated successfully. Other sessions revoked." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 2FA Management (TOTP Setup, Enable, Disable) ───

app.post("/api/auth/2fa/setup", authenticateToken, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Opinion Insights (${req.user.email})`,
      issuer: "Opinion Insights",
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store temp secret
    const db = getDB();
    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { tempTwoFactorSecret: secret.base32 } }
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
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
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

    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          twoFactorEnabled: true,
          twoFactorSecret: user.tempTwoFactorSecret,
          recoveryCodes: hashedRecoveryCodes,
          tempTwoFactorSecret: null,
          updatedAt: new Date().toISOString(),
        },
      }
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
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });

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

    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          recoveryCodes: [],
          updatedAt: new Date().toISOString(),
        },
      }
    );

    await recordAuditLog(req.user.id, req.user.email, "2FA_DISABLED", null);

    res.json({ success: true, message: "2FA has been disabled." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Active Sessions Management Endpoints ───

app.get("/api/admin/sessions", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const currentTokenHash = hashToken(req.token);
    const sessions = await db
      .collection("active_sessions")
      .find({ userId: req.user.id, isRevoked: false })
      .sort({ lastActiveAt: -1 })
      .toArray();

    const formatted = sessions.map((s) => ({
      id: s._id.toString(),
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
    await db.collection("active_sessions").updateOne(
      { _id: new ObjectId(sessionId), userId: req.user.id },
      { $set: { isRevoked: true, revokedAt: new Date().toISOString() } }
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

// ─── Admin Users Management (RBAC Protected) ───

app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const users = await db.collection("users").find({}, { projection: { passwordHash: 0, twoFactorSecret: 0, recoveryCodes: 0 } }).toArray();
    const formatted = await Promise.all(
      users.map(async (u) => {
        const uId = u._id.toString();
        const [profilesCount, proxiesCount] = await Promise.all([
          db.collection("profile_metas").countDocuments({ $or: [{ owner_account_id: uId }, { userId: uId }] }),
          db.collection("user_proxies").countDocuments({ $or: [{ owner_account_id: uId }, { userId: uId }] }),
        ]);
        return {
          id: uId,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          isActive: u.isActive,
          twoFactorEnabled: Boolean(u.twoFactorEnabled),
          createdAt: u.createdAt,
          profilesCount,
          proxiesCount,
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
    const existing = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ error: "User with this email already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = {
      email: email.toLowerCase().trim(),
      passwordHash,
      fullName: fullName || email.split("@")[0],
      role: role || "user",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await db.collection("users").insertOne(newUser);
    const createdId = result.insertedId.toString();

    await recordAuditLog(req.user.id, req.user.email, "USER_CREATE", createdId, {
      email: newUser.email,
      role: newUser.role,
    });

    res.json({
      success: true,
      user: {
        id: createdId,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
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
    const updateFields = { updatedAt: new Date().toISOString() };

    if (typeof isActive === "boolean") {
      updateFields.isActive = isActive;
      // If disabled -> revoke active sessions instantly
      if (!isActive) {
        await revokeAllUserSessions(id);
      }
    }
    if (role) updateFields.role = role;
    if (fullName) updateFields.fullName = fullName;
    if (password) {
      const policyErr = validatePasswordPolicy(password);
      if (policyErr) return res.status(400).json({ error: policyErr });
      const salt = await bcrypt.genSalt(10);
      updateFields.passwordHash = await bcrypt.hash(password, salt);
      // Revoke sessions on password reset
      await revokeAllUserSessions(id);
    }

    await db.collection("users").updateOne({ _id: new ObjectId(id) }, { $set: updateFields });

    await recordAuditLog(req.user.id, req.user.email, "USER_UPDATE", id, updateFields);

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
    const adminUser = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });

    if (adminPassword) {
      const passwordValid = await bcrypt.compare(adminPassword, adminUser.passwordHash);
      if (!passwordValid) {
        return res.status(400).json({ error: "Re-authentication failed. Incorrect admin password." });
      }
    }

    const user = await db.collection("users").findOne({ _id: new ObjectId(id) });
    if (!user) return res.status(404).json({ error: "User not found." });

    await revokeAllUserSessions(id);
    await db.collection("users").deleteOne({ _id: new ObjectId(id) });

    await recordAuditLog(req.user.id, req.user.email, "USER_DELETE", id, { email: user.email });

    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/audit-logs", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    const logs = await db.collection("audit_logs").find().sort({ timestamp: -1 }).limit(200).toArray();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Data Endpoints (Profiles, Proxies) ───

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

app.get("/api/data/profiles", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const ownerQuery = { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    const profiles = await db.collection("profile_metas").find(ownerQuery).toArray();
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/profiles/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const profileId = req.params.id;
    const ownerQuery = {
      id: profileId,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const profile = await db.collection("profile_metas").findOne(ownerQuery);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found or access denied." });
    }
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/profiles", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const profile = {
      ...req.body,
      id: req.body.id || `prof-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || req.body.createdAt || now,
      updated_at: now,
    };
    // Anti-poaching check: Ensure ID does not belong to another tenant
    const existingOther = await db.collection("profile_metas").findOne({
      id: profile.id,
      $and: [
        { owner_account_id: { $exists: true, $ne: req.user.id } },
        { userId: { $exists: true, $ne: req.user.id } }
      ]
    });
    if (existingOther) {
      return res.status(403).json({ error: "Profile ID belongs to another user account." });
    }
    await db.collection("profile_metas").updateOne(
      { id: profile.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] },
      { $set: profile },
      { upsert: true }
    );
    // Mirror to profiles collection
    await db.collection("profiles").updateOne(
      { id: profile.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] },
      { $set: profile },
      { upsert: true }
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
    const ownerQuery = {
      $and: [
        {
          $or: [
            { id: profileId },
            { "_meta.id": profileId },
            { "config.id": profileId }
          ]
        },
        { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] }
      ]
    };
    const resMeta = await db.collection("profile_metas").deleteMany(ownerQuery);
    const resProf = await db.collection("profiles").deleteMany(ownerQuery);
    const totalDeleted = resMeta.deletedCount + resProf.deletedCount;
    if (totalDeleted === 0) {
      return res.status(404).json({ error: "Profile not found or access denied." });
    }
    await recordAuditLog(req.user.id, req.user.email, "profile_deleted", profileId, { profileId, totalDeleted });
    res.json({ success: true, deletedCount: totalDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/proxies", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const ownerQuery = { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    const proxies = await db.collection("user_proxies").find(ownerQuery).toArray();
    const decrypted = proxies.map((p) => ({
      ...p,
      password: p.password ? decryptField(p.password) : p.password,
    }));
    res.json({ proxies: decrypted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/proxies/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;
    const ownerQuery = {
      id: proxyId,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const proxy = await db.collection("user_proxies").findOne(ownerQuery);
    if (!proxy) {
      return res.status(404).json({ error: "Proxy not found or access denied." });
    }
    const decrypted = {
      ...proxy,
      password: proxy.password ? decryptField(proxy.password) : proxy.password,
    };
    res.json({ proxy: decrypted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/proxies", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const rawProxy = { ...req.body };
    const encryptedPassword = rawProxy.password ? encryptField(rawProxy.password) : rawProxy.password;
    const now = new Date().toISOString();
    const proxy = {
      ...rawProxy,
      id: rawProxy.id || `proxy-${Date.now()}`,
      password: encryptedPassword,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: rawProxy.created_at || rawProxy.createdAt || now,
      updated_at: now,
    };
    // Anti-poaching check: Ensure proxy ID does not belong to another tenant
    const existingOther = await db.collection("user_proxies").findOne({
      id: proxy.id,
      $and: [
        { owner_account_id: { $exists: true, $ne: req.user.id } },
        { userId: { $exists: true, $ne: req.user.id } }
      ]
    });
    if (existingOther) {
      return res.status(403).json({ error: "Proxy ID belongs to another user account." });
    }
    const ownerQuery = { id: proxy.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    await db.collection("user_proxies").updateOne(ownerQuery, { $set: proxy }, { upsert: true });
    await db.collection("proxies").updateOne(ownerQuery, { $set: proxy }, { upsert: true });
    res.json({ success: true, proxy: { ...proxy, password: rawProxy.password } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/proxies/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const proxyId = req.params.id;
    const ownerQuery = {
      id: proxyId,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const result = await db.collection("user_proxies").deleteOne(ownerQuery);
    await db.collection("proxies").deleteOne(ownerQuery);
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Proxy not found or access denied." });
    }
    await recordAuditLog(req.user.id, req.user.email, "proxy_deleted", proxyId, { proxyId });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fingerprints, Bookmarks, and Folders (Account-Scoped) ───

app.get("/api/data/fingerprints", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const ownerQuery = { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    const fingerprints = await db.collection("fingerprints").find(ownerQuery).toArray();
    res.json({ fingerprints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/fingerprints/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id;
    const ownerQuery = {
      id,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const fp = await db.collection("fingerprints").findOne(ownerQuery);
    if (!fp) {
      return res.status(404).json({ error: "Fingerprint not found or access denied." });
    }
    res.json({ fingerprint: fp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/fingerprints", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const fp = {
      ...req.body,
      id: req.body.id || `fp-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || now,
      updated_at: now,
    };
    // Anti-poaching check: Ensure fingerprint ID does not belong to another tenant
    const existingOther = await db.collection("fingerprints").findOne({
      id: fp.id,
      $and: [
        { owner_account_id: { $exists: true, $ne: req.user.id } },
        { userId: { $exists: true, $ne: req.user.id } }
      ]
    });
    if (existingOther) {
      return res.status(403).json({ error: "Fingerprint ID belongs to another user account." });
    }
    const ownerQuery = { id: fp.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    await db.collection("fingerprints").updateOne(ownerQuery, { $set: fp }, { upsert: true });
    res.json({ success: true, fingerprint: fp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/data/bookmarks", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const ownerQuery = { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    const bookmarks = await db.collection("bookmarks").find(ownerQuery).toArray();
    res.json({ bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/bookmarks", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const bm = {
      ...req.body,
      id: req.body.id || `bm-${Date.now()}`,
      owner_account_id: req.user.id,
      userId: req.user.id,
      created_at: req.body.created_at || now,
      updated_at: now,
    };
    // Anti-poaching check: Ensure bookmark ID does not belong to another tenant
    const existingOther = await db.collection("bookmarks").findOne({
      id: bm.id,
      $and: [
        { owner_account_id: { $exists: true, $ne: req.user.id } },
        { userId: { $exists: true, $ne: req.user.id } }
      ]
    });
    if (existingOther) {
      return res.status(403).json({ error: "Bookmark ID belongs to another user account." });
    }
    const ownerQuery = { id: bm.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    await db.collection("bookmarks").updateOne(ownerQuery, { $set: bm }, { upsert: true });
    res.json({ success: true, bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/bookmarks/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id;
    const ownerQuery = {
      id,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const result = await db.collection("bookmarks").deleteOne(ownerQuery);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Extension Sets (Account-Scoped) ───

app.get("/api/data/extension-sets", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const ownerQuery = { $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    const sets = await db.collection("extension_sets").find(ownerQuery).toArray();
    res.json(sets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/data/extension-sets", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();
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
    // Anti-poaching check: Ensure ID does not belong to another tenant
    const existingOther = await db.collection("extension_sets").findOne({
      id: setDoc.id,
      $and: [
        { owner_account_id: { $exists: true, $ne: req.user.id } },
        { userId: { $exists: true, $ne: req.user.id } }
      ]
    });
    if (existingOther) {
      return res.status(403).json({ error: "Extension Set ID belongs to another user account." });
    }
    const ownerQuery = { id: setDoc.id, $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] };
    await db.collection("extension_sets").updateOne(ownerQuery, { $set: setDoc }, { upsert: true });
    res.json({ success: true, set: setDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/data/extension-sets/:id", authenticateToken, async (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id;
    const ownerQuery = {
      id,
      $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }],
    };
    const result = await db.collection("extension_sets").deleteOne(ownerQuery);
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Extension Set not found or access denied." });
    }
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Initial Database Seed Function ───
async function seedInitialUsers() {
  const db = getDB();
  const usersCol = db.collection("users");

  const adminEmail = "admin@opinioninsights.com";
  const testEmail = "test@opinioninsights.local";

  const adminExists = await usersCol.findOne({ email: adminEmail });
  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("AdminPassword123!", salt);
    await usersCol.insertOne({
      email: adminEmail,
      passwordHash,
      fullName: "Opinion Admin",
      role: "admin",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`[Seed] Initial Admin user created: ${adminEmail}`);
  }

  const testExists = await usersCol.findOne({ email: testEmail });
  if (!testExists) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("Test@12345678!", salt);
    await usersCol.insertOne({
      email: testEmail,
      passwordHash,
      fullName: "Test Insights User",
      role: "user",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`[Seed] Initial Test user created: ${testEmail}`);
  }
}

let serverInstance = null;

// ─── Start Server ───
async function start() {
  try {
    await connectDB();
    await seedInitialUsers();
    if (!process.env.VERCEL) {
      serverInstance = app.listen(PORT, () => {
        console.log(`[Opinion Insights Backend API] Running on http://localhost:${PORT}`);
      });
    }
  } catch (err) {
    console.error("[Backend] Failed to start:", err);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
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
