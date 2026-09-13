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
      try {
        const [insertResult] = await db.query(
          "INSERT INTO active_sessions (userId, userEmail, tokenHash, userAgent, ip, createdAt, lastActiveAt, isRevoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
          [
            parseInt(decoded.id, 10),
            decoded.email || "",
            tokenHashed,
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

  const now = Date.now();
  const createdAt = parseDateMs(session.createdAt);
  const lastActiveAt = parseDateMs(session.lastActiveAt);

  // Enforce Absolute Expiry
  if (now - createdAt > SESSION_ABSOLUTE_TIMEOUT_MS) {
    await db.query(
      "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE id = ?",
      [toMySQLDate(), session.id]
    );
    return { valid: false, reason: "absolute_timeout" };
  }

  // Enforce Idle Expiry
  if (now - lastActiveAt > SESSION_IDLE_TIMEOUT_MS) {
    await db.query(
      "UPDATE active_sessions SET isRevoked = 1, revokedAt = ? WHERE id = ?",
      [toMySQLDate(), session.id]
    );
    return { valid: false, reason: "idle_timeout" };
  }

  // Touch last active asynchronously (best-effort)
  db.query(
    "UPDATE active_sessions SET lastActiveAt = ? WHERE id = ?",
    [toMySQLDate(), session.id]
  ).catch(() => {});

  return { valid: true, session };
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
