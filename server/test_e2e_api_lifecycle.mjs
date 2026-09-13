import express from "express";
import http from "http";
import { ensureDB } from "./src/db.js";

async function run() {
  console.log("=== RUNNING E2E API & SESSION LIFECYCLE TEST ===\n");
  const { app } = await import("./src/index.js");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5099, resolve));
  const BASE = "http://127.0.0.1:5099/api";
  console.log("Test server running at", BASE);

  try {
    // 1. Admin Login
    console.log("\n1. Testing Admin Login...");
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@opinioninsights.in", password: "Delle6400@" }),
    });
    const loginData = await loginRes.json();
    console.log("  Status:", loginRes.status, "| Role:", loginData.user?.role);
    if (!loginRes.ok || !loginData.token) throw new Error("Admin login failed");
    const adminToken = loginData.token;

    // Check Set-Cookie
    const setCookie = loginRes.headers.get("set-cookie");
    console.log("  Set-Cookie present:", Boolean(setCookie), setCookie ? setCookie.substring(0, 40) + "..." : "");

    // 2. 10 Consecutive /auth/me calls (simulating rapid refresh & tab switching)
    console.log("\n2. Testing 10 consecutive /auth/me calls (session persistence)...");
    for (let i = 1; i <= 10; i++) {
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (meRes.status !== 200) {
        throw new Error(`Consecutive request #${i} failed with status ${meRes.status}`);
      }
    }
    console.log("  ✅ All 10 consecutive /auth/me requests succeeded (Status 200).");

    // 3. GET /api/admin/users
    console.log("\n3. Testing GET /api/admin/users...");
    const usersRes = await fetch(`${BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const usersData = await usersRes.json();
    console.log("  Status:", usersRes.status, "| Users count:", usersData.users?.length);
    console.log("  Pagination metadata:", usersData.pagination);
    if (!usersRes.ok || !Array.isArray(usersData.users) || usersData.users.length < 3) {
      throw new Error("GET /api/admin/users failed to return existing users");
    }
    for (const u of usersData.users) {
      console.log(`    - [${u.role}] ${u.email} | active: ${u.isActive} (${typeof u.isActive}) | profiles: ${u.profilesCount} | proxies: ${u.proxiesCount}`);
      if (typeof u.isActive !== "boolean") {
        throw new Error(`User ${u.email} isActive is not a boolean!`);
      }
    }
    console.log("  ✅ GET /api/admin/users returns valid, normalized users with pagination.");

    // 4. Vendor Login & RBAC enforcement
    console.log("\n4. Testing Vendor Login & Deny-by-Default RBAC...");
    const vendorLoginRes = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "vendor@opinioninsights.in", password: "Delle6400@" }),
    });
    const vendorData = await vendorLoginRes.json();
    const vendorToken = vendorData.token;

    const vendorAccessRes = await fetch(`${BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${vendorToken}` },
    });
    console.log("  Vendor access to /admin/users status:", vendorAccessRes.status);
    if (vendorAccessRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for vendor, got ${vendorAccessRes.status}`);
    }
    console.log("  ✅ Vendor is strictly denied (403) from accessing admin endpoints.");

    // 5. Explicit Logout & Token Revocation
    console.log("\n5. Testing Explicit Logout & Token Revocation...");
    const logoutRes = await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const logoutData = await logoutRes.json();
    console.log("  Logout response:", logoutRes.status, logoutData);
    if (!logoutRes.ok) throw new Error("Logout request failed");

    // Post-logout /auth/me check
    const postLogoutRes = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log("  Post-logout /auth/me status:", postLogoutRes.status);
    if (postLogoutRes.status !== 401) {
      throw new Error(`Expected 401 after logout, got ${postLogoutRes.status}`);
    }
    console.log("  ✅ Session token revoked in database. Subsequent requests return 401.");

    console.log("\n=== ALL E2E API & SESSION TESTS PASSED SUCCESSFULLY ===");
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error("❌ E2E ERROR:", err);
  process.exit(1);
});
