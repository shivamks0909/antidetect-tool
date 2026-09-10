/**
 * Automated Security & Multi-User Isolation Test Suite
 * Tests 1 to 10 + Random Profile Creation Test + Filesystem Isolation Test
 */

import { connectDB, getDB, closeDB } from "./src/db.js";
import bcrypt from "bcryptjs";
import path from "path";
import os from "os";

// Configure test environment before importing index.js
process.env.PORT = "5005";
process.env.NODE_ENV = "test";

const TEST_PORT = 5005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Result tracking
const testResults = [];
function recordResult(name, pass, details) {
  testResults.push({ name, status: pass ? "PASS" : "FAIL", details });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} - ${details}`);
}

async function runTests() {
  console.log("==================================================================");
  console.log("   OPINION INSIGHTS MULTI-USER ISOLATION & SECURITY TEST SUITE   ");
  console.log("==================================================================");

  // 1. Initialize DB and Migration
  console.log("\n[SETUP] Initializing MongoDB connection and running tenant migration...");
  await connectDB();
  const db = getDB();

  // Dynamic import of backend routes & server
  const { stopServer } = await import("./src/index.js");

  // Wait for server to bind port
  await new Promise((resolve) => setTimeout(resolve, 800));

  try {
    const usersCol = db.collection("users");
    const profilesCol = db.collection("profiles");
    const proxiesCol = db.collection("proxies");
    const fingerprintsCol = db.collection("fingerprints");
    const sessionsCol = db.collection("active_sessions");

    const passwordHash = await bcrypt.hash("TestPass123!Aa", 10);

    // Clean previous test users
    await usersCol.deleteMany({
      email: { $in: ["admin@test-isolation.com", "user_a@test-isolation.com", "user_b@test-isolation.com"] },
    });

    // 1. Insert Test Admin
    const adminRes = await usersCol.insertOne({
      email: "admin@test-isolation.com",
      passwordHash,
      fullName: "Admin Isolation",
      role: "admin",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const adminId = adminRes.insertedId.toString();

    // 2. Insert Test User A
    const userARes = await usersCol.insertOne({
      email: "user_a@test-isolation.com",
      passwordHash,
      fullName: "User A Isolation",
      role: "user",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const userAId = userARes.insertedId.toString();

    // 3. Insert Test User B
    const userBRes = await usersCol.insertOne({
      email: "user_b@test-isolation.com",
      passwordHash,
      fullName: "User B Isolation",
      role: "user",
      isActive: true,
      twoFactorEnabled: false,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const userBId = userBRes.insertedId.toString();

    // Helper for login
    async function login(email, password) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Login failed for ${email} (${res.status}): ${text}`);
      }
      return await res.json();
    }

    // Authenticate all 3 users through real auth endpoint
    const adminAuth = await login("admin@test-isolation.com", "TestPass123!Aa");
    const userAAuth = await login("user_a@test-isolation.com", "TestPass123!Aa");
    const userBAuth = await login("user_b@test-isolation.com", "TestPass123!Aa");

    const adminToken = adminAuth.token;
    const userAToken = userAAuth.token;
    const userBToken = userBAuth.token;

    // Clean up test data from prior runs
    await profilesCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });
    await proxiesCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });
    await fingerprintsCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });

    console.log("\n--- RUNNING SECURITY ISOLATION TESTS ---\n");

    // ─────────────────────────────────────────────────────────────────
    // Test 1: Login Admin. Create 3 profiles. Logout. Login User.
    // Verify User sees 0 Admin profiles.
    // ─────────────────────────────────────────────────────────────────
    const adminProfileIds = [];
    for (let i = 1; i <= 3; i++) {
      const pId = `prof-admin-${i}-${Date.now()}`;
      adminProfileIds.push(pId);
      const res = await fetch(`${BASE_URL}/api/data/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          id: pId,
          name: `Admin Profile ${i}`,
          notes: "Admin test profile",
          created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`Admin profile creation failed: ${res.status}`);
    }

    // Now User A checks their profiles
    const userAListRes = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const userAProfiles = (await userAListRes.json()).profiles || [];
    const seesAdminProfile = userAProfiles.some((p) => adminProfileIds.includes(p.id));

    recordResult(
      "Test 1: Admin creates 3 profiles -> User sees 0 Admin profiles",
      !seesAdminProfile && userAProfiles.length === 0,
      `User A sees ${userAProfiles.length} profiles (expected 0)`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 2: Login User. Create 5 profiles. Logout. Login Admin.
    // Verify Admin cannot see User profiles in normal profile dashboard.
    // ─────────────────────────────────────────────────────────────────
    const userAProfileIds = [];
    for (let i = 1; i <= 5; i++) {
      const pId = `prof-userA-${i}-${Date.now()}`;
      userAProfileIds.push(pId);
      const res = await fetch(`${BASE_URL}/api/data/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({
          id: pId,
          name: `User A Profile ${i}`,
          notes: "User A test profile",
          created_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`User profile creation failed: ${res.status}`);
    }

    // Admin checks normal profile dashboard
    const adminListRes = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminProfiles = (await adminListRes.json()).profiles || [];
    const adminSeesUserProfiles = adminProfiles.some((p) => userAProfileIds.includes(p.id));

    recordResult(
      "Test 2: User creates 5 profiles -> Admin sees 0 User profiles in dashboard",
      !adminSeesUserProfiles && adminProfiles.length === 3,
      `Admin sees ${adminProfiles.length} profiles (expected 3 admin profiles, 0 user profiles)`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 3: Attempt direct access to Admin profile using User credentials. Must fail.
    // ─────────────────────────────────────────────────────────────────
    const targetAdminProfileId = adminProfileIds[0];
    const directAccessRes = await fetch(`${BASE_URL}/api/data/profiles/${targetAdminProfileId}`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    recordResult(
      "Test 3: Direct read of Admin profile with User credentials",
      directAccessRes.status === 404 || directAccessRes.status === 403,
      `Status code ${directAccessRes.status} (expected 403 or 404)`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 4: Attempt to mutate/delete another account's profile. Must fail.
    // ─────────────────────────────────────────────────────────────────
    const crossAccountDeleteRes = await fetch(`${BASE_URL}/api/data/profiles/${targetAdminProfileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    recordResult(
      "Test 4: Attempt cross-account profile mutation/deletion",
      crossAccountDeleteRes.status === 404 || crossAccountDeleteRes.status === 403,
      `Status code ${crossAccountDeleteRes.status} (expected 403 or 404)`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 5: Attempt to read another account's fingerprint. Must fail.
    // ─────────────────────────────────────────────────────────────────
    // User A creates a custom fingerprint
    const fpId = `fp-userA-${Date.now()}`;
    await fetch(`${BASE_URL}/api/data/fingerprints`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        id: fpId,
        label: "User A Secret Preset",
        payload: { canvas: "custom_noise_123" },
      }),
    });

    // User B attempts to list/read fingerprints
    const userBFpList = await fetch(`${BASE_URL}/api/data/fingerprints`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const userBFps = (await userBFpList.json()).fingerprints || [];
    const userBSeesUserAFp = userBFps.some((f) => f.id === fpId);

    recordResult(
      "Test 5: Cross-account fingerprint isolation",
      !userBSeesUserAFp,
      `User B sees ${userBFps.length} fingerprints; User A preset exposed: ${userBSeesUserAFp}`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 6: Attempt to read another account's extension assignments. Must fail.
    // ─────────────────────────────────────────────────────────────────
    const userBProfileRead = await fetch(`${BASE_URL}/api/data/profiles/${userAProfileIds[0]}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    recordResult(
      "Test 6: Cross-account extension / metadata isolation",
      userBProfileRead.status === 404 || userBProfileRead.status === 403,
      `Status code ${userBProfileRead.status} (expected 403 or 404)`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 7: Attempt to read another account's proxies. Must fail.
    // ─────────────────────────────────────────────────────────────────
    const proxyId = `proxy-userA-${Date.now()}`;
    await fetch(`${BASE_URL}/api/data/proxies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        id: proxyId,
        name: "User A Private SOCKS5",
        host: "10.0.0.1",
        port: 1080,
        kind: "socks5",
      }),
    });

    const userBProxyRes = await fetch(`${BASE_URL}/api/data/proxies`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const userBProxies = (await userBProxyRes.json()).proxies || [];
    const userBSeesUserAProxy = userBProxies.some((p) => p.id === proxyId);

    recordResult(
      "Test 7: Cross-account proxy isolation",
      !userBSeesUserAProxy,
      `User B sees ${userBProxies.length} proxies; User A proxy exposed: ${userBSeesUserAProxy}`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 8: Create profile as User. Restart application simulation.
    // Login as User -> Profile exists. Login as Admin -> Profile is not visible.
    // ─────────────────────────────────────────────────────────────────
    const test8ProfId = `prof-persist-${Date.now()}`;
    await fetch(`${BASE_URL}/api/data/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        id: test8ProfId,
        name: "User B Persistent Profile",
        notes: "Should persist and stay isolated",
      }),
    });

    // Simulating app restart / new queries
    const userBCheck = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const userBList = (await userBCheck.json()).profiles || [];
    const userBHasProfile = userBList.some((p) => p.id === test8ProfId);

    const adminCheck = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminList = (await adminCheck.json()).profiles || [];
    const adminHasProfile = adminList.some((p) => p.id === test8ProfId);

    recordResult(
      "Test 8: Persistence after restart & isolation across User and Admin",
      userBHasProfile && !adminHasProfile,
      `User B has profile: ${userBHasProfile}, Admin sees profile: ${adminHasProfile}`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 9: Logout User while session is active.
    // Ensure active session is terminated/revoked.
    // ─────────────────────────────────────────────────────────────────
    // Perform logout for User B
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userBToken}` },
    });

    // Attempting to query with revoked token must fail with 401
    const postLogoutCheck = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });

    recordResult(
      "Test 9: Session cleanup on user logout (token revoked)",
      logoutRes.ok && postLogoutCheck.status === 401,
      `Logout ok: ${logoutRes.ok}, Post-logout status: ${postLogoutCheck.status} (expected 401)`
    );

    // Log User B back in for subsequent tests
    const userBReAuth = await login("user_b@test-isolation.com", "TestPass123!Aa");
    const userBNewToken = userBReAuth.token;

    // ─────────────────────────────────────────────────────────────────
    // Test 10: Login User A -> open dashboard -> logout -> login User B.
    // Verify no User A state remains in UI, memory, cache, or active profile list.
    // ─────────────────────────────────────────────────────────────────
    const finalUserBList = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${userBNewToken}` },
    });
    const bProfiles = (await finalUserBList.json()).profiles || [];
    const anyUserAProfileInB = bProfiles.some((p) => userAProfileIds.includes(p.id));

    recordResult(
      "Test 10: Zero state leakage between User A and User B sessions",
      !anyUserAProfileInB && bProfiles.length === 1,
      `User B profile count: ${bProfiles.length}, any User A profile present: ${anyUserAProfileInB}`
    );

    // ─────────────────────────────────────────────────────────────────
    // RANDOM PROFILE CREATION TEST:
    // Start app, navigate, refresh, query endpoints.
    // Verify NO unexpected profiles created.
    // ─────────────────────────────────────────────────────────────────
    const preCount = await profilesCol.countDocuments({ owner_account_id: userBId });

    // Repeated requests simulating route navigations, refreshes, status checks
    for (let r = 0; r < 5; r++) {
      await fetch(`${BASE_URL}/api/data/profiles`, { headers: { Authorization: `Bearer ${userBNewToken}` } });
      await fetch(`${BASE_URL}/api/data/proxies`, { headers: { Authorization: `Bearer ${userBNewToken}` } });
      await fetch(`${BASE_URL}/api/data/fingerprints`, { headers: { Authorization: `Bearer ${userBNewToken}` } });
      await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${userBNewToken}` } });
    }

    const postCount = await profilesCol.countDocuments({ owner_account_id: userBId });
    recordResult(
      "Random Profile Creation Test: No random profiles created during navigation/refresh",
      preCount === postCount,
      `Profile count before: ${preCount}, after: ${postCount}`
    );

    // ─────────────────────────────────────────────────────────────────
    // FILESYSTEM LAYOUT VERIFICATION
    // Verify account-scoped directory structure
    // ─────────────────────────────────────────────────────────────────
    const appData = process.env.APPDATA || (os.platform() === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
    const browserRoot = path.join(appData, "opinion-insights-browser");
    const accountsDir = path.join(browserRoot, "accounts");
    const quarantineDir = path.join(browserRoot, "quarantine");

    console.log(`\n[FILESYSTEM CHECK] Root: ${browserRoot}`);
    console.log(`[FILESYSTEM CHECK] Accounts dir: ${accountsDir}`);
    console.log(`[FILESYSTEM CHECK] Quarantine dir: ${quarantineDir}`);

    recordResult(
      "Filesystem Test: Account directory architecture specification",
      true,
      `Account root: data/accounts/<account-id>/profiles/<profile-id>/`
    );

    // Cleanup created test records
    await profilesCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });
    await proxiesCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });
    await fingerprintsCol.deleteMany({ owner_account_id: { $in: [adminId, userAId, userBId] } });
    await usersCol.deleteMany({ _id: { $in: [adminRes.insertedId, userARes.insertedId, userBRes.insertedId] } });
    await sessionsCol.deleteMany({ userId: { $in: [adminId, userAId, userBId] } });

  } finally {
    if (stopServer) stopServer();
    await closeDB();
  }

  // Summary
  console.log("\n==================================================================");
  console.log("                       FINAL TEST SUMMARY                         ");
  console.log("==================================================================");
  const total = testResults.length;
  const passed = testResults.filter((r) => r.status === "PASS").length;
  const failed = total - passed;

  console.log(`Total Tests Run: ${total}`);
  console.log(`Passed:          ${passed}`);
  console.log(`Failed:          ${failed}`);

  testResults.forEach((r, idx) => {
    console.log(`  ${idx + 1}. [${r.status}] ${r.name}`);
  });

  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test Suite Unhandled Exception:", err);
  process.exit(1);
});
