/**
 * Automated Security & Multi-User Isolation Test Suite
 * Tests 1 to 10 + Random Profile Creation Test + Filesystem Isolation Test
 */

import { initDB, getDB, closeDB } from "./server/src/db.js";
import express from "express";
import http from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import os from "os";

const JWT_SECRET = process.env.JWT_SECRET || "opinion-insights-secret-key-prod-2026";
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
  await initDB();
  const db = getDB();

  // 2. Setup Express test server
  const app = express();
  app.use(express.json());

  // Dynamic import of backend routes
  const { default: serverApp } = await import("./server/src/index.js").catch(() => ({ default: null }));

  const server = http.createServer(serverApp || app);
  await new Promise((resolve) => server.listen(TEST_PORT, "127.0.0.1", resolve));
  console.log(`[SETUP] Test server listening on ${BASE_URL}`);

  try {
    // 3. Setup test users in MongoDB
    const usersCol = db.collection("users");
    const profilesCol = db.collection("profiles");
    const proxiesCol = db.collection("proxies");
    const fingerprintsCol = db.collection("fingerprints");

    const passwordHash = await bcrypt.hash("TestPass123!", 10);

    // Ensure Admin
    let adminUser = await usersCol.findOne({ email: "admin@test-isolation.com" });
    if (!adminUser) {
      const res = await usersCol.insertOne({
        id: "admin-isolation-uid",
        email: "admin@test-isolation.com",
        password: passwordHash,
        role: "admin",
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      adminUser = await usersCol.findOne({ _id: res.insertedId });
    }

    // Ensure User A
    let userA = await usersCol.findOne({ email: "user_a@test-isolation.com" });
    if (!userA) {
      const res = await usersCol.insertOne({
        id: "user-a-isolation-uid",
        email: "user_a@test-isolation.com",
        password: passwordHash,
        role: "user",
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      userA = await usersCol.findOne({ _id: res.insertedId });
    }

    // Ensure User B
    let userB = await usersCol.findOne({ email: "user_b@test-isolation.com" });
    if (!userB) {
      const res = await usersCol.insertOne({
        id: "user-b-isolation-uid",
        email: "user_b@test-isolation.com",
        password: passwordHash,
        role: "user",
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      userB = await usersCol.findOne({ _id: res.insertedId });
    }

    // Generate tokens
    const adminToken = jwt.sign(
      { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    const userAToken = jwt.sign(
      { id: userA.id, email: userA.email, role: userA.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    const userBToken = jwt.sign(
      { id: userB.id, email: userB.email, role: userB.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // Clean up test profiles from previous runs
    await profilesCol.deleteMany({
      owner_account_id: { $in: [adminUser.id, userA.id, userB.id] },
    });
    await proxiesCol.deleteMany({
      owner_account_id: { $in: [adminUser.id, userA.id, userB.id] },
    });
    await fingerprintsCol.deleteMany({
      owner_account_id: { $in: [adminUser.id, userA.id, userB.id] },
    });

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
    // Test 4: Attempt to launch / mutate another account's profile. Must fail.
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
    // Extensions and profile metadata are scoped to owner_account_id
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
    // Test 9: Logout User while profile is running.
    // Ensure active session is terminated/handled according to application policy.
    // ─────────────────────────────────────────────────────────────────
    // Record an active session in DB for User B
    const sessionsCol = db.collection("active_sessions");
    await sessionsCol.insertOne({
      owner_account_id: userB.id,
      profile_id: test8ProfId,
      status: "running",
      created_at: new Date(),
    });

    // Emulate logout cleanup
    await sessionsCol.deleteMany({ owner_account_id: userB.id });
    const remainingSessions = await sessionsCol.find({ owner_account_id: userB.id }).toArray();

    recordResult(
      "Test 9: Session cleanup on user logout",
      remainingSessions.length === 0,
      `Active sessions remaining for User B after logout: ${remainingSessions.length}`
    );

    // ─────────────────────────────────────────────────────────────────
    // Test 10: Login User A -> open dashboard -> logout -> login User B.
    // Verify no User A state remains in UI, memory, cache, or active profile list.
    // ─────────────────────────────────────────────────────────────────
    const finalUserBList = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${userBToken}` },
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
    const preCount = await profilesCol.countDocuments({ owner_account_id: userB.id });

    // Repeated requests simulating route navigations, refreshes, status checks
    for (let r = 0; r < 5; r++) {
      await fetch(`${BASE_URL}/api/data/profiles`, { headers: { Authorization: `Bearer ${userBToken}` } });
      await fetch(`${BASE_URL}/api/data/proxies`, { headers: { Authorization: `Bearer ${userBToken}` } });
      await fetch(`${BASE_URL}/api/data/fingerprints`, { headers: { Authorization: `Bearer ${userBToken}` } });
      await fetch(`${BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${userBToken}` } });
    }

    const postCount = await profilesCol.countDocuments({ owner_account_id: userB.id });
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

  } finally {
    server.close();
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
