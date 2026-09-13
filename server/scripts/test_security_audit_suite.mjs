import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  verifyAndRehash,
  constantTimeCompare,
  randomOpaqueId,
  hashToken,
} from "../src/security/crypto.js";
import {
  createSession,
  validateSession,
  revokeSession,
  revokeSessionById,
  revokeAllOtherSessions,
  revokeAllUserSessions,
  getUserActiveSessions,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
} from "../src/security/sessions.js";
import {
  requireRole,
  requireReAuth,
  issueReAuthToken,
  assertProfileOwnership,
  assertProxyOwnership,
  redactSensitive,
} from "../src/security/policy.js";
import { getDB, ensureDB } from "../src/db.js";
import bcrypt from "bcryptjs";

console.log("=================================================");
console.log("🔒 RUNNING COMPREHENSIVE AUTH & SECURITY TEST SUITE");
console.log("=================================================\n");

async function runSuite() {
  const db = await ensureDB();
  let passedCount = 0;
  let totalTests = 0;

  function recordPass(testName) {
    totalTests++;
    passedCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  }

  function recordFail(testName, error) {
    totalTests++;
    console.error(`  ❌ [FAIL] ${testName}:`, error.message);
  }

  // ----------------------------------------------------
  // Test 1: Argon2id Hashing & Password Verification
  // ----------------------------------------------------
  try {
    const rawPass = "Delle6400@TestSpecial!";
    const argonHash = await hashPassword(rawPass);
    assert(argonHash.startsWith("$argon2id$"), "Hash must be an Argon2id format");

    const match = await verifyPassword(rawPass, argonHash);
    assert.equal(match, true, "Argon2id password verification failed for valid password");

    const mismatch = await verifyPassword("WrongPassword123!", argonHash);
    assert.equal(mismatch, false, "Argon2id password verification should fail for invalid password");

    recordPass("Argon2id password hashing and constant-time verification");
  } catch (err) {
    recordFail("Argon2id password hashing and constant-time verification", err);
  }

  // ----------------------------------------------------
  // Test 2: Transparent Legacy Bcrypt Hash Migration
  // ----------------------------------------------------
  try {
    const legacyPass = "OldBcryptSecret#123";
    const bcryptSalt = await bcrypt.genSalt(10);
    const legacyBcryptHash = await bcrypt.hash(legacyPass, bcryptSalt);

    const upgradeResult = await verifyAndRehash(legacyPass, legacyBcryptHash);
    assert.equal(upgradeResult.isValid, true, "Bcrypt hash should verify successfully");
    assert.equal(upgradeResult.needsUpgrade, true, "Bcrypt hash must trigger needsUpgrade flag");
    assert(upgradeResult.newHash.startsWith("$argon2id$"), "New hash must be upgraded to Argon2id");

    // Re-verifying the new Argon2id hash should report needsUpgrade = false
    const modernResult = await verifyAndRehash(legacyPass, upgradeResult.newHash);
    assert.equal(modernResult.isValid, true, "Upgraded Argon2id hash should verify");
    assert.equal(modernResult.needsUpgrade, false, "Upgraded Argon2id hash should NOT require upgrade");

    recordPass("Transparent legacy bcrypt to Argon2id hash migration");
  } catch (err) {
    recordFail("Transparent legacy bcrypt to Argon2id hash migration", err);
  }

  // ----------------------------------------------------
  // Test 3: Session Creation, Opaque ID & Database Indexing
  // ----------------------------------------------------
  let testUserId = 99991;
  let testEmail = "test.security@opinioninsights.in";
  let sessionToken = "oi_test_tok_" + randomOpaqueId(32);

  try {
    const sessionId = await createSession(db, testUserId, testEmail, sessionToken, "Mozilla/5.0 Test Suite", "127.0.0.1");
    assert(sessionId, "Session ID should be generated");

    const validation = await validateSession(db, sessionToken);
    assert.equal(validation.valid, true, "Fresh session should validate successfully");
    assert.equal(validation.session.userId, testUserId, "Session user ID mismatch");

    recordPass("Session creation, SHA-256 token indexing and validation");
  } catch (err) {
    recordFail("Session creation, SHA-256 token indexing and validation", err);
  }

  // ----------------------------------------------------
  // Test 4: Session Idle Timeout Enforcement
  // ----------------------------------------------------
  try {
    const idleToken = "oi_idle_tok_" + randomOpaqueId(32);
    await createSession(db, testUserId, testEmail, idleToken, "Test Device", "127.0.0.1");

    // Artificially simulate 3 hours of inactivity (threshold is 2h)
    const tokenHashed = hashToken(idleToken);
    const simulatedPast = new Date(Date.now() - (SESSION_IDLE_TIMEOUT_MS + 60000)).toISOString().replace("T", " ").replace("Z", "");
    await db.query("UPDATE active_sessions SET lastActiveAt = ? WHERE tokenHash = ?", [simulatedPast, tokenHashed]);

    const check = await validateSession(db, idleToken);
    assert.equal(check.valid, false, "Idle session must be invalid");
    assert.equal(check.reason, "idle_timeout", "Reason must be idle_timeout");

    recordPass("Session idle timeout enforcement (2-hour limit)");
  } catch (err) {
    recordFail("Session idle timeout enforcement (2-hour limit)", err);
  }

  // ----------------------------------------------------
  // Test 5: Session Absolute Lifetime Enforcement
  // ----------------------------------------------------
  try {
    const absToken = "oi_abs_tok_" + randomOpaqueId(32);
    await createSession(db, testUserId, testEmail, absToken, "Test Device", "127.0.0.1");

    // Artificially simulate 13 hours age (threshold is 12h)
    const tokenHashed = hashToken(absToken);
    const simulatedCreation = new Date(Date.now() - (SESSION_ABSOLUTE_TIMEOUT_MS + 60000)).toISOString().replace("T", " ").replace("Z", "");
    await db.query("UPDATE active_sessions SET createdAt = ? WHERE tokenHash = ?", [simulatedCreation, tokenHashed]);

    const check = await validateSession(db, absToken);
    assert.equal(check.valid, false, "Over-aged session must be invalid");
    assert.equal(check.reason, "absolute_timeout", "Reason must be absolute_timeout");

    recordPass("Session absolute timeout enforcement (12-hour limit)");
  } catch (err) {
    recordFail("Session absolute timeout enforcement (12-hour limit)", err);
  }

  // ----------------------------------------------------
  // Test 6: Single & Bulk Session Revocation
  // ----------------------------------------------------
  try {
    const tok1 = "tok_active_1_" + randomOpaqueId(16);
    const tok2 = "tok_active_2_" + randomOpaqueId(16);
    const tok3 = "tok_active_3_" + randomOpaqueId(16);

    const s1 = await createSession(db, testUserId, testEmail, tok1, "Device 1", "127.0.0.1");
    await createSession(db, testUserId, testEmail, tok2, "Device 2", "127.0.0.1");
    await createSession(db, testUserId, testEmail, tok3, "Device 3", "127.0.0.1");

    // Revoke s1 by ID
    const revokedById = await revokeSessionById(db, s1, testUserId);
    assert.equal(revokedById, true, "revokeSessionById should succeed");
    const check1 = await validateSession(db, tok1);
    assert.equal(check1.valid, false, "Session 1 must be invalid after revocation");

    // Revoke all other sessions keeping tok2
    const revokedOthers = await revokeAllOtherSessions(db, testUserId, tok2);
    assert(revokedOthers >= 1, "Should have revoked at least session 3");

    const check2 = await validateSession(db, tok2);
    assert.equal(check2.valid, true, "Kept session tok2 must remain valid");

    const check3 = await validateSession(db, tok3);
    assert.equal(check3.valid, false, "Other session tok3 must be revoked");

    recordPass("Granular session revocation and revoke-all-others");
  } catch (err) {
    recordFail("Granular session revocation and revoke-all-others", err);
  }

  // ----------------------------------------------------
  // Test 7: IDOR / BOLA Prevention (Profile & Proxy Ownership)
  // ----------------------------------------------------
  try {
    const userA = "1001";
    const userB = "1002";
    const profileIdA = "prof_isolation_test_a";

    // Insert user A's profile
    await db.query(
      "INSERT INTO profile_metas (id, owner_account_id, userId, document) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE owner_account_id = VALUES(owner_account_id)",
      [profileIdA, userA, userA, JSON.stringify({ name: "User A Profile", browser: "Chrome" })]
    );

    // User A should be allowed
    const authOwner = await assertProfileOwnership(db, profileIdA, userA, "user");
    assert.equal(authOwner.allowed, true, "Owner must be allowed to access profile");

    // User B must be denied (Horizontal privilege escalation attempt)
    const authAttacker = await assertProfileOwnership(db, profileIdA, userB, "user");
    assert.equal(authAttacker.allowed, false, "Non-owner user must be strictly denied");
    assert.equal(authAttacker.reason, "forbidden", "Reason must be forbidden");

    // Admin should be allowed
    const authAdmin = await assertProfileOwnership(db, profileIdA, "999", "admin");
    assert.equal(authAdmin.allowed, true, "Admin role allowed cross-tenant profile oversight");

    recordPass("Server-side IDOR / BOLA boundary enforcement");
  } catch (err) {
    recordFail("Server-side IDOR / BOLA boundary enforcement", err);
  }

  // ----------------------------------------------------
  // Test 8: RBAC Middleware & Deny-by-Default
  // ----------------------------------------------------
  try {
    const adminOnlyMiddleware = requireRole(["admin"]);

    // Test non-admin request
    let nextCalled = false;
    let statusCode = null;
    let jsonPayload = null;

    const fakeReqUser = { user: { id: "1001", role: "user" } };
    const fakeRes = {
      status(c) { statusCode = c; return this; },
      json(d) { jsonPayload = d; return this; }
    };

    adminOnlyMiddleware(fakeReqUser, fakeRes, () => { nextCalled = true; });
    assert.equal(nextCalled, false, "Regular user should never pass admin-only middleware");
    assert.equal(statusCode, 403, "Status code must be 403 Forbidden");

    // Test admin request
    nextCalled = false;
    const fakeReqAdmin = { user: { id: "1", role: "admin" } };
    adminOnlyMiddleware(fakeReqAdmin, fakeRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true, "Admin user must pass admin-only middleware");

    recordPass("RBAC role policy and deny-by-default authorization");
  } catch (err) {
    recordFail("RBAC role policy and deny-by-default authorization", err);
  }

  // ----------------------------------------------------
  // Test 9: Re-Authentication Requirement for Sensitive Actions
  // ----------------------------------------------------
  try {
    const adminPass = "Delle6400@TestReAuth!";
    const hashedAdmin = await hashPassword(adminPass);
    const adminUserId = 88881;

    await db.query(
      "INSERT INTO users (id, email, passwordHash, fullName, role, isActive, twoFactorEnabled) VALUES (?, ?, ?, ?, ?, 1, 0) ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash)",
      [adminUserId, "reauth.admin@opinioninsights.in", hashedAdmin, "ReAuth Admin", "admin"]
    );

    // 1. Without password or token -> 403
    let reauthPassed = false;
    let reauthStatus = null;
    let reauthBody = null;

    const unauthReq = {
      user: { id: String(adminUserId), email: "reauth.admin@opinioninsights.in", role: "admin" },
      headers: {},
      body: {}
    };
    const mockRes = {
      status(c) { reauthStatus = c; return this; },
      json(d) { reauthBody = d; return this; }
    };

    await requireReAuth(unauthReq, mockRes, () => { reauthPassed = true; });
    assert.equal(reauthPassed, false, "Unauthenticated sensitive action must be blocked");
    assert.equal(reauthStatus, 403, "Must return 403");
    assert.equal(reauthBody.requireReAuth, true, "Must flag requireReAuth = true");

    // 2. With valid password -> 200 (next)
    reauthPassed = false;
    const directPwReq = {
      user: { id: String(adminUserId), email: "reauth.admin@opinioninsights.in", role: "admin" },
      headers: {},
      body: { password: adminPass }
    };
    await requireReAuth(directPwReq, mockRes, () => { reauthPassed = true; });
    assert.equal(reauthPassed, true, "Sensitive action with verified password must pass");

    // 3. With elevated re-auth token
    reauthPassed = false;
    const reAuthToken = issueReAuthToken(adminUserId, "reauth.admin@opinioninsights.in");
    const tokenReq = {
      user: { id: String(adminUserId), email: "reauth.admin@opinioninsights.in", role: "admin" },
      headers: { "x-reauth-token": reAuthToken },
      body: {}
    };
    await requireReAuth(tokenReq, mockRes, () => { reauthPassed = true; });
    assert.equal(reauthPassed, true, "Sensitive action with elevated reAuthToken must pass");

    recordPass("Re-authentication gate for privileged & sensitive operations");
  } catch (err) {
    recordFail("Re-authentication gate for privileged & sensitive operations", err);
  }

  // ----------------------------------------------------
  // Test 10: Sensitive Key Redaction in Logs & DTOs
  // ----------------------------------------------------
  try {
    const sensitivePayload = {
      id: "proxy-123",
      username: "adminUser",
      password: "SuperSecretProxyPassword#1",
      token: "jwt.secret.bearer.token",
      proxy_password: "AnotherPlaintextSecret",
      safeKey: "public_value"
    };

    const cleaned = redactSensitive(sensitivePayload);
    assert.equal(cleaned.password, "[REDACTED]", "Password must be redacted");
    assert.equal(cleaned.token, "[REDACTED]", "Token must be redacted");
    assert.equal(cleaned.proxy_password, "[REDACTED]", "Proxy password must be redacted");
    assert.equal(cleaned.safeKey, "public_value", "Safe key must be preserved");

    recordPass("Deep sensitive secrets redaction in logs and errors");
  } catch (err) {
    recordFail("Deep sensitive secrets redaction in logs and errors", err);
  }

  // Clean up test data
  try {
    await db.query("DELETE FROM active_sessions WHERE userId IN (?, ?)", [testUserId, 88881]);
    await db.query("DELETE FROM users WHERE id = ?", [88881]);
    await db.query("DELETE FROM profile_metas WHERE id = 'prof_isolation_test_a'");
  } catch (_) {}

  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passedCount}/${totalTests} TESTS PASSED`);
  console.log("=================================================");

  if (passedCount === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runSuite().catch((e) => {
  console.error("FATAL SUITE ERROR:", e);
  process.exit(1);
});
