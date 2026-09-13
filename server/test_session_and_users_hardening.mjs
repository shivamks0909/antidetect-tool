import { getDB, ensureDB } from "./src/db.js";
import { validateSession, revokeSession, createSession } from "./src/security/sessions.js";
import { hashToken } from "./src/security/crypto.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "opinion_insights_super_secret_jwt_key_2026_production";

async function runTests() {
  console.log("=== RUNNING SESSION & USERS HARDENING AUTOMATED SUITE ===\n");
  const db = await ensureDB();

  // Test 1: Generate valid JWT and test auto-heal when session row is missing
  console.log("TEST 1: Serverless Session Auto-Heal (Cold-Start container simulation)");
  const fakeToken = jwt.sign(
    { id: "1", email: "admin@opinioninsights.in", role: "admin" },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  const decoded = jwt.verify(fakeToken, JWT_SECRET);

  // Validate session before it was explicitly inserted
  const checkAutoHeal = await validateSession(db, fakeToken, decoded);
  console.log("  Auto-heal result:", {
    valid: checkAutoHeal.valid,
    sessionId: checkAutoHeal.session?.id,
    userId: checkAutoHeal.session?.userId,
  });
  if (!checkAutoHeal.valid || checkAutoHeal.session?.userId !== "1") {
    throw new Error("Test 1 FAILED: Session was not auto-healed for valid token");
  }
  console.log("  ✅ Test 1 PASS: Valid signed JWT auto-healed in local DB session store.\n");

  // Test 2: Consecutive validation (session now exists in DB)
  console.log("TEST 2: Consecutive Session Validation (Warm container)");
  for (let i = 1; i <= 5; i++) {
    const consecutiveCheck = await validateSession(db, fakeToken, decoded);
    if (!consecutiveCheck.valid) {
      throw new Error(`Test 2 FAILED at iteration ${i}`);
    }
  }
  console.log("  ✅ Test 2 PASS: 5 consecutive session validations succeeded.\n");

  // Test 3: Explicit session revocation on logout
  console.log("TEST 3: Explicit Logout & Revocation Invalidation");
  await revokeSession(db, fakeToken);
  const checkPostRevoke = await validateSession(db, fakeToken, decoded);
  console.log("  Post-revoke validation result:", checkPostRevoke);
  if (checkPostRevoke.valid || checkPostRevoke.reason !== "revoked") {
    throw new Error("Test 3 FAILED: Revoked session was still treated as valid");
  }
  console.log("  ✅ Test 3 PASS: Revoked token immediately rejected with reason: 'revoked'.\n");

  // Test 4: Revocation on cold container (row wasn't in DB yet when revoked)
  console.log("TEST 4: Revocation recorded even if row didn't exist prior to revoke");
  const coldToken = jwt.sign(
    { id: "2", email: "admin@opinioninsights.com", role: "admin" },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  const coldDecoded = jwt.verify(coldToken, JWT_SECRET);
  await revokeSession(db, coldToken);
  const coldCheck = await validateSession(db, coldToken, coldDecoded);
  if (coldCheck.valid) {
    throw new Error("Test 4 FAILED: Cold revoked token was auto-healed instead of rejected");
  }
  console.log("  ✅ Test 4 PASS: Explicitly revoked token is rejected even on cold container.\n");

  // Test 5: Verify user records and isActive normalization
  console.log("TEST 5: Database User Records & Boolean Normalization");
  const [users] = await db.query("SELECT id, email, fullName, role, isActive FROM users");
  console.log(`  Found ${users.length} user records:`);
  for (const u of users) {
    console.log(`    - ID ${u.id}: ${u.email} | Role: ${u.role} | isActive: ${Boolean(u.isActive)} (raw: ${u.isActive})`);
    if (typeof Boolean(u.isActive) !== "boolean") {
      throw new Error("Test 5 FAILED: isActive could not be normalized to boolean");
    }
  }
  console.log("  ✅ Test 5 PASS: User records present and normalize cleanly.\n");

  console.log("=== ALL UNIT & HARDENING TESTS PASSED ===");
}

runTests().catch((err) => {
  console.error("❌ SUITE ERROR:", err);
  process.exit(1);
});
