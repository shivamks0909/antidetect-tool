import { hash, verify, Algorithm } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * OWASP Recommended Argon2id parameters
 * memoryCost: 19456 (19 MB) minimum for standard serverless, or 65536 (64 MB) for robust servers.
 * timeCost: 2 or 3 iterations.
 * parallelism: 1 or 2 threads.
 */
const ARGON2_CONFIG = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hash password using modern OWASP-compliant Argon2id.
 */
export async function hashPassword(plainPassword) {
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    throw new Error("Password must be a non-empty string.");
  }
  return await hash(plainPassword, ARGON2_CONFIG);
}

/**
 * Synchronously hash password using Argon2id for synchronous engine initialization.
 */
export function hashPasswordSync(plainPassword) {
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    throw new Error("Password must be a non-empty string.");
  }
  return hashSync(plainPassword, ARGON2_CONFIG);
}

/**
 * Verify password against either an Argon2id hash or legacy bcrypt hash.
 */
export async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;

  try {
    if (storedHash.startsWith("$argon2")) {
      return await verify(storedHash, plainPassword);
    }
    if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
      return await bcrypt.compare(plainPassword, storedHash);
    }
  } catch (err) {
    console.error("[Security/Crypto] Password verification error:", err.message);
    return false;
  }
  return false;
}

/**
 * Verifies password and transparently indicates if the hash is legacy (e.g. bcrypt)
 * and should be updated to Argon2id in the database.
 */
export async function verifyAndRehash(plainPassword, storedHash) {
  const isValid = await verifyPassword(plainPassword, storedHash);
  if (!isValid) {
    return { isValid: false, needsUpgrade: false, newHash: null };
  }

  const isLegacy = !storedHash.startsWith("$argon2id$");
  if (isLegacy) {
    const newHash = await hashPassword(plainPassword);
    return { isValid: true, needsUpgrade: true, newHash };
  }

  return { isValid: true, needsUpgrade: false, newHash: null };
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function constantTimeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Hash both to equalize lengths and do dummy compare to maintain constant time
    const hashA = crypto.createHash("sha256").update(bufA).digest();
    const hashB = crypto.createHash("sha256").update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates high-entropy opaque random string.
 */
export function randomOpaqueId(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Deterministic SHA-256 hash for indexing sensitive session tokens in database.
 */
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
