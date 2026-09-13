import assert from "assert";
import jwt from "jsonwebtoken";
import { connectDB, getDB, autoFixDatabase } from "../src/db.js";
import {
  createSessionWithRefresh,
  rotateRefreshToken,
  revokeSessionFamily,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
} from "../src/security/sessions.js";
import app, { stopServer } from "../src/index.js";

const PORT = 5098;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log("==================================================");
  console.log("  AUTH LIFECYCLE & PERSISTENT SESSION TEST SUITE  ");
  console.log("==================================================");

  let testsPassed = 0;
  let testsFailed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      testsPassed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      testsFailed++;
    }
  }

  await test("1. Database & Server Setup", async () => {
    await connectDB();
    await autoFixDatabase();
    app.listen(PORT);
  });

  let accessToken = "";
  let refreshToken = "";
  let userObj = null;

  await test("2. Login issues short-lived access token and persistent refresh token", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@opinioninsights.in", password: "Delle6400@" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.token, "Must return access token");
    assert.ok(data.refreshToken, "Must return refresh token");
    assert.strictEqual(typeof data.refreshToken, "string");
    assert.ok(data.refreshToken.length >= 32, "Refresh token must be cryptographically long");
    accessToken = data.token;
    refreshToken = data.refreshToken;
    userObj = data.user;

    // Verify access token is a valid JWT with 15m lifetime
    const decoded = jwt.decode(accessToken);
    assert.strictEqual(decoded.email, "admin@opinioninsights.in");
    const lifetimeSec = decoded.exp - decoded.iat;
    assert.ok(lifetimeSec <= 15 * 60, "Access token lifetime must be short-lived (<= 15m)");
  });

  await test("3. Authenticated request succeeds with access token", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.email, "admin@opinioninsights.in");
  });

  let rotatedAccessToken = "";
  let rotatedRefreshToken = "";

  await test("4. Silent Refresh rotates refresh token and issues fresh access token", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.token, "Must return new access token");
    assert.ok(data.refreshToken, "Must return rotated refresh token");
    assert.notStrictEqual(data.refreshToken, refreshToken, "Refresh token must be rotated to a new secret");
    rotatedAccessToken = data.token;
    rotatedRefreshToken = data.refreshToken;
  });

  await test("5. Replaying rotated token within 30s grace window succeeds (race condition protection)", async () => {
    // Immediate concurrent retry with old refreshToken should succeed in grace window
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    assert.strictEqual(res.status, 200, "Must tolerate concurrent refresh in 30s grace window");
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await test("6. Replaying rotated token outside grace window triggers REUSE DETECTION", async () => {
    // Simulate rotation was 60 seconds ago (outside grace window)
    const db = getDB();
    const sixtySecAgo = new Date(Date.now() - 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    await db.query("UPDATE active_sessions SET lastActiveAt = ? WHERE isRotated = 1", [sixtySecAgo]);

    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, "REUSE_DETECTED");
  });

  await test("6b. Token family revoked after reuse detection", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rotatedRefreshToken }),
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.code, "REVOKED");
  });

  let freshAccess = "";
  let freshRefresh = "";

  await test("7. New login establishes clean session family", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@opinioninsights.in", password: "Delle6400@" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    freshAccess = data.token;
    freshRefresh = data.refreshToken;
  });

  await test("8. Persistent session not revoked on idle (Simulated 8-hour idle)", async () => {
    const db = getDB();
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    await db.query(
      "UPDATE active_sessions SET lastActiveAt = ? WHERE userEmail = ?",
      [eightHoursAgo, "admin@opinioninsights.in"]
    );

    // Refresh should STILL succeed because session persistence is not dropped on idle
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: freshRefresh }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    freshAccess = data.token;
    freshRefresh = data.refreshToken;
  });

  let vendorAccess = "";
  let vendorRefresh = "";

  await test("9. Vendor login establishes persistent session with vendor role", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "vendor@opinioninsights.in", password: "Delle6400@" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.role, "vendor");
    assert.ok(data.token);
    assert.ok(data.refreshToken);
    vendorAccess = data.token;
    vendorRefresh = data.refreshToken;
  });

  await test("10. Vendor can access proxy monitor stats and fleet via requireStaff", async () => {
    const statsRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor/stats`, {
      headers: { Authorization: `Bearer ${vendorAccess}` },
    });
    assert.strictEqual(statsRes.status, 200, "Vendor must be allowed on proxy monitor stats");

    const listRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor`, {
      headers: { Authorization: `Bearer ${vendorAccess}` },
    });
    assert.strictEqual(listRes.status, 200, "Vendor must be allowed on proxy monitor list");
  });

  await test("11. Vendor is denied access to admin-only user management (RBAC preserved)", async () => {
    const usersRes = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${vendorAccess}` },
    });
    assert.strictEqual(usersRes.status, 403, "Vendor must be rejected from user management");
  });

  await test("12. Vendor persistent session survives overnight idle (24 hours)", async () => {
    const db = getDB();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    await db.query(
      "UPDATE active_sessions SET lastActiveAt = ?, createdAt = ? WHERE userEmail = ?",
      [yesterday, yesterday, "vendor@opinioninsights.in"]
    );

    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: vendorRefresh }),
    });
    assert.strictEqual(res.status, 200, "Vendor session must not expire after overnight idle");
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.role, "vendor");
    vendorAccess = data.token;
    vendorRefresh = data.refreshToken;
  });

  await test("13. Account deactivation immediately revokes session on next refresh", async () => {
    const db = getDB();
    // Temporarily deactivate vendor account
    await db.query("UPDATE users SET isActive = 0 WHERE email = ?", ["vendor@opinioninsights.in"]);

    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: vendorRefresh }),
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.code, "ACCOUNT_DISABLED");
    } finally {
      // Re-enable vendor account
      await db.query("UPDATE users SET isActive = 1 WHERE email = ?", ["vendor@opinioninsights.in"]);
    }
  });

  await test("14. Explicit logout permanently invalidates session family", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshAccess}`,
      },
      body: JSON.stringify({ refreshToken: freshRefresh }),
    });
    assert.strictEqual(res.status, 200);

    // Subsequent refresh must fail with REVOKED
    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: freshRefresh }),
    });
    assert.strictEqual(refreshRes.status, 401);
  });

  console.log("==================================================");
  console.log(`RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log("==================================================");

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});
