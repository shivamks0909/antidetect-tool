import jwt from "jsonwebtoken";
import { verifyPassword } from "./crypto.js";

const REAUTH_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const JWT_SECRET = process.env.JWT_SECRET || "opinion-insights-jwt-secret-2026";

/**
 * Deny-by-default role authorization middleware.
 */
export function requireRole(allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: "Unauthorized: Authentication required." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Insufficient privileges. Required role: [${roles.join(", ")}].`,
      });
    }
    next();
  };
}

/**
 * Re-authentication middleware for high-risk operations.
 * Accepts either:
 * - Direct password verification in header `x-reauth-password` or body `password` / `reauth_password`
 * - Valid short-lived re-auth token in header `x-reauth-token`
 */
export async function requireReAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const reauthToken = req.headers["x-reauth-token"] || req.body?.reauthToken;
  const rawPassword =
    req.headers["x-reauth-password"] ||
    req.body?.currentPassword ||
    req.body?.reauthPassword ||
    req.body?.adminPassword ||
    req.body?.password;

  // 1. Validate elevated re-auth token if provided
  if (reauthToken) {
    try {
      const decoded = jwt.verify(reauthToken, JWT_SECRET);
      if (decoded.scope === "reauth" && decoded.userId === String(req.user.id)) {
        return next();
      }
    } catch {
      // Invalid/expired reauth token, proceed to password check
    }
  }

  // 2. Validate current password directly
  if (rawPassword) {
    try {
      const db = req.db || (await import("../db.js")).getDB();
      const [rows] = await db.query("SELECT passwordHash FROM users WHERE id = ? LIMIT 1", [parseInt(req.user.id, 10)]);
      if (rows.length > 0 && (await verifyPassword(rawPassword, rows[0].passwordHash))) {
        return next();
      }
    } catch (err) {
      console.error("[Security/Policy] Re-auth verification error:", err.message);
    }
  }

  return res.status(403).json({
    error: "Privileged action requires re-authentication. Provide valid password or re-auth token.",
    requireReAuth: true,
  });
}

/**
 * Issues short-lived elevated re-auth token upon verified password.
 */
export function issueReAuthToken(userId, email) {
  return jwt.sign(
    { userId: String(userId), email, scope: "reauth" },
    JWT_SECRET,
    { expiresIn: "5m" }
  );
}

/**
 * Asserts profile ownership server-side.
 * Never trust client-supplied userId or owner_account_id.
 */
export async function assertProfileOwnership(db, profileId, actorUserId, actorRole) {
  const [rows] = await db.query(
    "SELECT id, owner_account_id, userId, document FROM profile_metas WHERE id = ? LIMIT 1",
    [profileId]
  );

  if (rows.length === 0) {
    return { allowed: false, reason: "not_found", profile: null };
  }

  const p = rows[0];
  const ownerId = String(p.owner_account_id || p.userId || "");

  // Admins can manage any profile; regular users can only access their own
  if (actorRole === "admin" || ownerId === String(actorUserId)) {
    const doc = typeof p.document === "string" ? JSON.parse(p.document) : p.document;
    return { allowed: true, profile: { id: p.id, ...doc } };
  }

  return { allowed: false, reason: "forbidden", profile: null };
}

/**
 * Asserts proxy ownership server-side.
 */
export async function assertProxyOwnership(db, proxyId, actorUserId, actorRole) {
  const [rows] = await db.query(
    "SELECT * FROM profile_proxies WHERE id = ? LIMIT 1",
    [proxyId]
  );

  if (rows.length === 0) {
    return { allowed: false, reason: "not_found", proxy: null };
  }

  const prx = rows[0];
  const ownerId = String(prx.account_id || prx.user_id || "");

  if (actorRole === "admin" || ownerId === String(actorUserId)) {
    return { allowed: true, proxy: prx };
  }

  return { allowed: false, reason: "forbidden", proxy: null };
}

/**
 * Sanitizes object by redacting sensitive secrets.
 */
export function redactSensitive(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);

  const isSensitiveKey = (k) => {
    const l = k.toLowerCase();
    return (
      l.includes("password") ||
      l.includes("secret") ||
      l.includes("token") ||
      l.includes("auth") ||
      l.includes("cookie") ||
      l.includes("credential")
    );
  };

  const sanitized = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      sanitized[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      sanitized[k] = redactSensitive(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
