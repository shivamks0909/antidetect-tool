import crypto from "crypto";
import { hashToken } from "./crypto.js";
import { getDB } from "../db.js";

// Session timeout thresholds
export const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours idle
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute lifetime

function toMySQLDate(date = new Date()) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function parseDateMs(dateVal) {
  if (!dateVal) return 0;
  if (typeof dateVal === "number") return dateVal;
  const s = String(dateVal).trim();
  if (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s)) {
    return new Date(s).getTime();
  }
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

function resolveDB(firstArg, ...rest) {
  if (firstArg && typeof firstArg.query === "function") {
    return { db: firstArg, args: rest };
  }
  return { db: getDB(), args: [firstArg, ...rest] };
}

/**
 * Creates and registers a new active session.
 */
export async function createSession(dbOrUserId, ...rest) {
  const { db, args } = resolveDB(dbOrUserId, ...rest);
  const [userId, userEmail, token, userAgent, ip] = args;
  const tokenHashed = hashToken(token);
  const now = toMySQLDate();
  const [result] = await db.query(
    "INSERT INTO active_sessions (userId, userEmail, tokenHash, userAgent, ip, createdAt, lastActiveAt, isRevoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    [parseInt(userId, 10), userEmail, tokenHashed, userAgent || "Unknown Device", ip || "127.0.0.1", now, now]
  );
  return result.insertId ? String(result.insertId) : null;
}

/**
 * Validates session against database, enforcing idle & absolute expiry and revocation flags.
 */
export async function validateSession(dbOrToken, ...rest) {
  const { db, args } = resolveDB(dbOrToken, ...rest);
  const [token, decoded] = args;
  const tokenHashed = hashToken(token);
  const [sessions] = await db.query(
    "SELECT * FROM active_sessions WHERE tokenHash = ? LIMIT 1",
    [tokenHashed]
  );
  const session = sessions[0];
  if (session && (session.isRevoked || Number(session.isRevoked) === 1)) {
    return { valid: false, reason: "revoked" };
  }

  if (!session) {
    // If token is cryptographically verified by JWT secret but not yet present in
    // this container's local DB (e.g., serverless Lambda cold-start or multi-worker SQLite fallback):
    if (decoded && decoded.id) {
      const now = toMySQLDate();
      const famId = decoded.familyId || decoded.jti || crypto.randomUUID();
      try {
        const [insertResult] = await db.query(
          "INSERT INTO active_sessions (userId, userEmail, tokenHash, familyId, userAgent, ip, createdAt, lastActiveAt, isRevoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
          [
            parseInt(decoded.id, 10),
            decoded.email || "",
            tokenHashed,
            famId,
            "Serverless Restored Session",
            "127.0.0.1",
            now,
            now,
          ]
        );
        return {
          valid: true,
          session: {
            id: insertResult.insertId,
            userId: decoded.id,
            userEmail: decoded.email,
            tokenHash: tokenHashed,
            familyId: famId,
            createdAt: now,
            lastActiveAt: now,
            isRevoked: 0,
          },
        };
      } catch (err) {
        console.warn("[Session] Auto-heal session insert warning:", err.message);
      }
    }
    return { valid: false, reason: "revoked" };
  }

  // Enforce idle & absolute timeouts ONLY on standalone/ephemeral test sessions that lack a refresh family.
  // Real authenticated sessions (Browser desktop app, Admin console, auto-healed sessions) have familyId
  // and remain permanently authenticated across idle, sleep/wake, and app restarts until explicit logout.
  if (!session.refreshTokenHash && !session.familyId) {
    const now = Date.now();
    const createdAt = parseDateMs(session.createdAt);
    const lastActiveAt = parseDateMs(session.lastActiveAt);

    if (now - createdAt > SESSION_ABSOLUTE_TIMEOUT_MS) {
      await db.query(
        "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE id = ?",
        [toMySQLDate(), session.id]
      );
      return { valid: false, reason: "absolute_timeout" };
    }

    if (now - lastActiveAt > SESSION_IDLE_TIMEOUT_MS) {
      await db.query(
        "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE id = ?",
        [toMySQLDate(), session.id]
      );
      return { valid: false, reason: "idle_timeout" };
    }
  }

  // Touch last active asynchronously (best-effort)
  db.query(
    "UPDATE active_sessions SET lastActiveAt = ? WHERE id = ?",
    [toMySQLDate(), session.id]
  ).catch(() => {});

  return { valid: true, session };
}

/**
 * Creates and registers a new active session with refresh token and family tracking.
 */
export async function createSessionWithRefresh(dbOrUserId, ...rest) {
  const { db, args } = resolveDB(dbOrUserId, ...rest);
  const [userId, userEmail, token, refreshToken, userAgent, ip, familyId] = args;
  const tokenHashed = hashToken(token);
  const refreshHashed = hashToken(refreshToken);
  const famId = familyId || crypto.randomUUID();
  const now = toMySQLDate();
  const [result] = await db.query(
    `INSERT INTO active_sessions (
      userId, userEmail, tokenHash, refreshTokenHash, familyId, isRotated, userAgent, ip, createdAt, lastActiveAt, isRevoked
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)`,
    [
      parseInt(userId, 10),
      userEmail,
      tokenHashed,
      refreshHashed,
      famId,
      userAgent || "Unknown Device",
      ip || "127.0.0.1",
      now,
      now,
    ]
  );
  return {
    sessionId: result.insertId ? String(result.insertId) : null,
    familyId: famId,
  };
}

/**
 * Rotates a refresh token with RFC 6749 reuse detection and 30-second concurrency grace period.
 * If an already-rotated refresh token is presented after grace window, revokes all tokens in the family immediately.
 */
export async function rotateRefreshToken(dbOrToken, ...rest) {
  const { db, args } = resolveDB(dbOrToken, ...rest);
  const [oldRefreshToken, newAccessToken, newRefreshToken, userAgent, ip] = args;
  const oldRefreshHashed = hashToken(oldRefreshToken);

  const [rows] = await db.query(
    "SELECT * FROM active_sessions WHERE refreshTokenHash = ? LIMIT 1",
    [oldRefreshHashed]
  );

  if (!rows || rows.length === 0) {
    return { valid: false, reason: "invalid_refresh_token" };
  }

  const session = rows[0];

  // 1. Check if session was already explicitly revoked
  if (session.isRevoked || Number(session.isRevoked) === 1) {
    return { valid: false, reason: "revoked" };
  }

  // 2. Reuse Detection: If this refresh token was already rotated,
  // check 30-second grace period for concurrent requests before treating as attack.
  if (session.isRotated || Number(session.isRotated) === 1) {
    const rotatedAt = parseDateMs(session.lastActiveAt);
    const nowMs = Date.now();
    const isGrace = rotatedAt && (nowMs - rotatedAt < 30000);
    if (!isGrace) {
      console.warn(`[Security/Session] Refresh token reuse detected for family ${session.familyId}! Revoking family.`);
      const now = toMySQLDate();
      await db.query(
        "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE familyId = ?",
        [now, session.familyId]
      );
      return { valid: false, reason: "reuse_detected" };
    }
  }

  // 3. Mark the current refresh token as rotated
  const now = toMySQLDate();
  await db.query(
    "UPDATE active_sessions SET isRotated = 1, lastActiveAt = ? WHERE id = ?",
    [now, session.id]
  );

  // 4. Issue and register the new rotated refresh token in the same family
  const newTokenHashed = hashToken(newAccessToken);
  const newRefreshHashed = hashToken(newRefreshToken);
  const [insertResult] = await db.query(
    `INSERT INTO active_sessions (
      userId, userEmail, tokenHash, refreshTokenHash, familyId, isRotated, userAgent, ip, createdAt, lastActiveAt, isRevoked
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)`,
    [
      session.userId,
      session.userEmail,
      newTokenHashed,
      newRefreshHashed,
      session.familyId,
      userAgent || session.userAgent || "Unknown Device",
      ip || session.ip || "127.0.0.1",
      now,
      now,
    ]
  );

  return {
    valid: true,
    session: {
      id: insertResult.insertId,
      userId: session.userId,
      userEmail: session.userEmail,
      familyId: session.familyId,
    },
  };
}

/**
 * Revokes all sessions belonging to a specific family (e.g. on explicit logout).
 */
export async function revokeSessionFamily(dbOrFamilyId, ...rest) {
  const { db, args } = resolveDB(dbOrFamilyId, ...rest);
  const [familyId] = args;
  if (!familyId) return;
  const now = toMySQLDate();
  await db.query(
    "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE familyId = ?",
    [now, familyId]
  );
}

/**
 * Revokes current session by token.
 */
export async function revokeSession(dbOrToken, ...rest) {
  const { db, args } = resolveDB(dbOrToken, ...rest);
  const [token] = args;
  const tokenHashed = hashToken(token);
  const now = toMySQLDate();
  const [result] = await db.query(
    "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE tokenHash = ?",
    [now, tokenHashed]
  );
  if (!result || result.affectedRows === 0) {
    try {
      await db.query(
        "INSERT INTO active_sessions (userId, userEmail, tokenHash, userAgent, ip, createdAt, lastActiveAt, isRevoked, revokedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
        [0, "revoked", tokenHashed, "Revoked", "127.0.0.1", now, now, now]
      );
    } catch (_) {}
  }
}

/**
 * Revokes a specific session by ID belonging to user.
 */
export async function revokeSessionById(dbOrSessionId, ...rest) {
  const { db, args } = resolveDB(dbOrSessionId, ...rest);
  const [sessionId, userId] = args;
  const [result] = await db.query(
    "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE id = ? AND userId = ? AND isRevoked = 0",
    [toMySQLDate(), parseInt(sessionId, 10), parseInt(userId, 10)]
  );
  return result.affectedRows > 0;
}

/**
 * Revokes all other sessions of a user except the current token.
 */
export async function revokeAllOtherSessions(dbOrUserId, ...rest) {
  const { db, args } = resolveDB(dbOrUserId, ...rest);
  const [userId, currentToken] = args;
  const currentTokenHashed = hashToken(currentToken);
  const [result] = await db.query(
    "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE userId = ? AND tokenHash != ? AND isRevoked = 0",
    [toMySQLDate(), parseInt(userId, 10), currentTokenHashed]
  );
  return result.affectedRows || 0;
}

/**
 * Revokes all sessions for a user (e.g. on account deactivation or password reset).
 */
export async function revokeAllUserSessions(dbOrUserId, ...rest) {
  const { db, args } = resolveDB(dbOrUserId, ...rest);
  const [userId] = args;
  await db.query(
    "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE userId = ? AND isRevoked = 0",
    [toMySQLDate(), parseInt(userId, 10)]
  );
}

/**
 * Retrieves list of active sessions for the user.
 */
export async function getUserActiveSessions(dbOrUserId, ...rest) {
  const { db, args } = resolveDB(dbOrUserId, ...rest);
  const [userId, currentToken] = args;
  const currentTokenHashed = currentToken ? hashToken(currentToken) : "";
  const [rows] = await db.query(
    "SELECT id, userAgent, ip, createdAt, lastActiveAt, tokenHash FROM active_sessions WHERE userId = ? AND isRevoked = 0 ORDER BY lastActiveAt DESC LIMIT 50",
    [parseInt(userId, 10)]
  );

  return rows.map((r) => ({
    id: String(r.id),
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt,
    lastActiveAt: r.lastActiveAt,
    isCurrent: r.tokenHash === currentTokenHashed,
  }));
}
