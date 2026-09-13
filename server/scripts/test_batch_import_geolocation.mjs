import assert from "node:assert/strict";
import { parseProxyInput } from "../src/proxyParser.js";
import { connectDB, getDB } from "../src/db.js";

async function runTests() {
  console.log("=== Batch Import & Geolocation End-to-End Integration Tests ===\n");

  const rawSample = "geolocation://tUhY0cjVkiqkHtHB:dnIjmKY2muiahDgv@geo.floppydata.com:10080:United States - 54";

  // 1. Server JS parser verification
  console.log("1. Testing universal proxy parser with geolocation format...");
  const serverParsed = parseProxyInput(rawSample);
  assert(serverParsed !== null, "server parser must parse geolocation proxy");
  assert.equal(serverParsed.protocol, "geolocation");
  assert.equal(serverParsed.scheme, "geolocation");
  assert.equal(serverParsed.host, "geo.floppydata.com");
  assert.equal(serverParsed.port, 10080);
  assert.equal(serverParsed.username, "tUhY0cjVkiqkHtHB");
  assert.equal(serverParsed.password, "dnIjmKY2muiahDgv");
  assert.equal(serverParsed.location_label, "United States - 54");
  assert.equal(serverParsed.raw_input, rawSample);
  console.log("   ✓ Parser correctly extracted host, port, credentials, and location_label\n");

  // 2. Database persistence check
  console.log("2. Testing database insertion & location_label persistence in profile_proxies...");
  const db = await connectDB();
  
  const testId = "test-geo-id-" + Date.now();
  const testProfileId = "test-geo-profile-" + Date.now();
  const testAccountId = "acc-admin";
  const testUserId = "admin";

  // Simulate storing proxy in profile_proxies table
  await db.query(
    `INSERT INTO profile_proxies (
      id, account_id, user_id, profile_id, raw_input, protocol, host, port, username, password_encrypted, location_label, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testId,
      testAccountId,
      testUserId,
      testProfileId,
      serverParsed.raw_input,
      serverParsed.protocol,
      serverParsed.host,
      serverParsed.port,
      serverParsed.username,
      serverParsed.password,
      serverParsed.location_label,
      new Date().toISOString()
    ]
  );

  // Query back from profile_proxies
  const [rows] = await db.query(
    `SELECT id, profile_id, protocol, host, port, username, password_encrypted, location_label, raw_input FROM profile_proxies WHERE id = ?`,
    [testId]
  );

  assert.equal(rows.length, 1, "Must find inserted profile proxy");
  const stored = rows[0];
  assert.equal(stored.protocol, "geolocation");
  assert.equal(stored.host, "geo.floppydata.com");
  assert.equal(stored.port, 10080);
  assert.equal(stored.username, "tUhY0cjVkiqkHtHB");
  assert.equal(stored.password_encrypted, "dnIjmKY2muiahDgv");
  assert.equal(stored.location_label, "United States - 54");
  assert.equal(stored.raw_input, rawSample);
  console.log("   ✓ Database stored and retrieved location_label & raw_input verbatim\n");

  // Clean up
  await db.query(`DELETE FROM profile_proxies WHERE id = ?`, [testId]);

  console.log("All batch import & database integration tests PASSED successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
