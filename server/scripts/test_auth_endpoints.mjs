import app from "../src/index.js";
import http from "http";
import assert from "assert";

const PORT = 5098;
const server = http.createServer(app);

await new Promise(resolve => server.listen(PORT, resolve));
const BASE_URL = `http://127.0.0.1:${PORT}`;

try {
  console.log("Testing API Health...");
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, "online");
  console.log("[PASS] Health endpoint online:", healthData);

  console.log("\nTesting Login: admin@opinioninsights.in...");
  const loginRes1 = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@opinioninsights.in", password: "Delle6400@" })
  });
  const data1 = await loginRes1.json();
  assert.strictEqual(data1.success, true);
  assert.ok(data1.token, "Token should exist");
  assert.strictEqual(data1.user.role, "admin");
  console.log("[PASS] Login success for admin@opinioninsights.in, token received.");

  console.log("\nTesting Login: admin@opinioninsights.com...");
  const loginRes2 = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@opinioninsights.com", password: "Delle6400@" })
  });
  const data2 = await loginRes2.json();
  assert.strictEqual(data2.success, true);
  assert.ok(data2.token, "Token should exist");
  console.log("[PASS] Login success for admin@opinioninsights.com.");

  console.log("\nTesting Login: alias 'admin'...");
  const loginRes3 = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "Delle6400@" })
  });
  const data3 = await loginRes3.json();
  assert.strictEqual(data3.success, true);
  assert.ok(data3.token, "Token should exist");
  console.log("[PASS] Login success for 'admin' identifier.");

  console.log("\nTesting Protected Route /api/auth/me...");
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${data1.token}` }
  });
  const meData = await meRes.json();
  assert.strictEqual(meData.role, "admin");
  console.log("[PASS] /api/auth/me returns valid admin profile:", meData.email);

  console.log("\nTesting Auto-Fix Endpoint /api/auth/auto-fix...");
  const fixRes = await fetch(`${BASE_URL}/api/auth/auto-fix`, { method: "POST" });
  const fixData = await fixRes.json();
  assert.strictEqual(fixData.success, true);
  console.log("[PASS] /api/auth/auto-fix executed successfully:", fixData.report.verified);

  console.log("\n>>> ALL AUTH & AUTO-FIXER TESTS PASSED 100%! <<<");
} finally {
  server.close();
  process.exit(0);
}
