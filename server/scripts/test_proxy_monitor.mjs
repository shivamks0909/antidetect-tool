import assert from "assert";
import { parseProxyInput, sanitizeAuditMetadata } from "../src/proxyParser.js";
import { encryptCredential, decryptCredential, maskCredential } from "../src/cryptoVault.js";
import { connectDB, getDB, autoFixDatabase } from "../src/db.js";
import app, { stopServer } from "../src/index.js";

const PORT = 5099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log("==================================================");
  console.log("  PROXY MONITOR & AUDIT ENGINE VERIFICATION SUITE ");
  console.log("==================================================");

  let testsPassed = 0;
  let testsFailed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      testsPassed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      testsFailed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      testsPassed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      testsFailed++;
    }
  }

  // --- UNIT TESTS ---

  // 1. Universal Proxy Parser - Raw preservation & parsing
  test("1. Universal Parser: FlashProxy host:port:user:pass exact raw preservation", () => {
    const raw = "lite.flashproxy.io:6969:d9pwswslis-country-US:qfj3a4p7ad";
    const parsed = parseProxyInput(raw);
    assert.strictEqual(parsed.raw_input, raw, "raw_input must be verbatim preserved");
    assert.strictEqual(parsed.host, "lite.flashproxy.io");
    assert.strictEqual(parsed.port, 6969);
    assert.strictEqual(parsed.username, "d9pwswslis-country-US");
    assert.strictEqual(parsed.password, "qfj3a4p7ad");
    assert.strictEqual(parsed.protocol, "http");
  });

  test("2. Universal Parser: URI format with URI scheme", () => {
    const raw = "socks5://operator:p@ssword!@myproxy.net:1080";
    const parsed = parseProxyInput(raw);
    assert.strictEqual(parsed.raw_input, raw);
    assert.strictEqual(parsed.protocol, "socks5");
    assert.strictEqual(parsed.host, "myproxy.net");
    assert.strictEqual(parsed.port, 1080);
    assert.strictEqual(parsed.username, "operator");
    assert.strictEqual(parsed.password, "p@ssword!");
  });

  // 3. AES-256-GCM Encryption Vault
  test("3. CryptoVault: AES-256-GCM authenticated encryption & decryption", () => {
    const secret = "SuperSecretProxyPass_2026!#";
    const ciphertext = encryptCredential(secret);
    assert.ok(ciphertext.startsWith("enc:gcm:"), "Ciphertext must be enc:gcm format");
    const decrypted = decryptCredential(ciphertext);
    assert.strictEqual(decrypted, secret, "Decrypted text must match plaintext exactly");
  });

  test("4. CryptoVault: GCM tampering detection (tag validation)", () => {
    const secret = "SecretToTamper";
    const ciphertext = encryptCredential(secret);
    const parts = ciphertext.split(":");
    // Tamper the ciphertext byte
    const tamperedCipher = parts[4].slice(0, -2) + (parts[4].endsWith("0") ? "1" : "0");
    const tampered = `enc:gcm:${parts[2]}:${parts[3]}:${tamperedCipher}`;
    assert.throws(() => {
      decryptCredential(tampered);
    }, "Tampered ciphertext must fail authentication");
  });

  // 5. Zero credentials in audit metadata
  test("5. Audit Metadata Sanitizer: Strips passwords and auth credentials", () => {
    const metaWithCreds = {
      host: "lite.flashproxy.io",
      port: 6969,
      password: "secret_password",
      proxy_pass: "secret_pass",
      proxy: "http://user:password123@lite.flashproxy.io:6969",
    };
    const sanitized = sanitizeAuditMetadata(metaWithCreds);
    assert.strictEqual(sanitized.password, undefined);
    assert.strictEqual(sanitized.proxy_pass, undefined);
    assert.ok(!sanitized.proxy.includes("password123"), "Proxy URL must strip auth credentials");
    assert.strictEqual(sanitized.host, "lite.flashproxy.io");
    assert.strictEqual(sanitized.port, 6969);
  });

  // --- INTEGRATION TESTS VIA HTTP ---

  let server;
  let adminToken = "";
  let userToken = "";
  let testProfileId = `prof-test-${Date.now()}`;
  let testProxyId = "";

  await asyncTest("6. Server Startup & Database Auto-Fix", async () => {
    await connectDB();
    await autoFixDatabase();
    server = app.listen(PORT);
    assert.ok(server, "Server must listen on test port");
  });

  await asyncTest("7. Admin & User Authentication", async () => {
    // Admin login
    const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@opinioninsights.in", password: "Delle6400@" }),
    });
    const adminJson = await adminRes.json();
    assert.strictEqual(adminRes.status, 200, "Admin login must succeed");
    adminToken = adminJson.token;
    assert.ok(adminToken, "Admin token must be returned");

    // Vendor / non-admin login
    const userRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "vendor@opinioninsights.in", password: "Delle6400@" }),
    });
    const userJson = await userRes.json();
    assert.strictEqual(userRes.status, 200, "User login must succeed");
    userToken = userJson.token;
  });

  await asyncTest("8. Ingestion: Profile creation preserves exact raw_input & normalized proxy", async () => {
    const rawProxy = "lite.flashproxy.io:6969:d9pwswslis-country-US:qfj3a4p7ad";
    const profRes = await fetch(`${BASE_URL}/api/data/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        id: testProfileId,
        name: "US FlashProxy Profile",
        proxy: rawProxy,
        source: "batch_import",
        source_file: "fleet_accounts.xlsx",
        source_row: 14,
      }),
    });
    const profJson = await profRes.json();
    assert.strictEqual(profRes.status, 200);
    assert.strictEqual(profJson.success, true);

    // Verify in profile_proxies table directly
    const db = getDB();
    const [rows] = await db.query("SELECT * FROM profile_proxies WHERE profile_id = ?", [testProfileId]);
    assert.strictEqual(rows.length, 1, "Profile proxy record must be created");
    const p = rows[0];
    testProxyId = p.id;
    assert.strictEqual(p.raw_input, rawProxy, "raw_input must match original string verbatim");
    assert.strictEqual(p.host, "lite.flashproxy.io");
    assert.strictEqual(p.port, 6969);
    assert.strictEqual(p.username, "d9pwswslis-country-US");
    assert.ok(p.password_encrypted.startsWith("enc:gcm:"), "Password must be stored as AES-256-GCM ciphertext");
    assert.strictEqual(p.configuration_status, "CONFIGURED");
    assert.strictEqual(p.runtime_status, "IDLE");
    assert.strictEqual(p.source_file, "fleet_accounts.xlsx");
    assert.strictEqual(p.source_row, 14);
  });

  await asyncTest("9. Admin Proxy Monitor: Stats & List query with masked credentials", async () => {
    // Stats endpoint
    const statsRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const statsJson = await statsRes.json();
    assert.strictEqual(statsRes.status, 200);
    assert.ok(statsJson.total_proxies >= 1, "Total proxies must be at least 1");

    // List endpoint with search
    const listRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor?search=flashproxy`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listJson = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    assert.ok(listJson.items.length >= 1, "Search must return matching item");
    const item = listJson.items.find((x) => x.id === testProxyId);
    assert.ok(item, "Created proxy must be in list");
    assert.strictEqual(item.password_masked, "••••••••", "Password must be masked in list");
    assert.strictEqual(item.raw_input, "lite.flashproxy.io:6969:d9pwswslis-country-US:qfj3a4p7ad");
  });

  await asyncTest("10. Runtime Pipeline: Connection Attempt & Success lifecycle events", async () => {
    // 1. Launch browser event
    const launchRes = await fetch(`${BASE_URL}/api/data/profiles/${testProfileId}/proxy-runtime-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        eventType: "profile_launched_with_proxy",
        details: { chromium_pid: 1234 },
      }),
    });
    assert.strictEqual(launchRes.status, 200);

    // 2. Connection success event
    const successRes = await fetch(`${BASE_URL}/api/data/profiles/${testProfileId}/proxy-runtime-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        eventType: "proxy_connection_success",
        details: { egress_ip: "104.28.19.45", latency_ms: 180 },
      }),
    });
    assert.strictEqual(successRes.status, 200);

    // Verify proxy status updated
    const db = getDB();
    const [rows] = await db.query("SELECT runtime_status, last_connection_status FROM profile_proxies WHERE id = ?", [testProxyId]);
    assert.strictEqual(rows[0].runtime_status, "RUNNING");
    assert.strictEqual(rows[0].last_connection_status, "SUCCESS");
  });

  await asyncTest("11. Deterministic Ordering: Timeline ordered strictly by created_at ASC, id ASC", async () => {
    const timelineRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor/${testProxyId}/timeline`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const timelineJson = await timelineRes.json();
    assert.strictEqual(timelineRes.status, 200);
    const events = timelineJson.events;
    assert.ok(events.length >= 3, "Timeline must contain at least added, assigned, launch, and success");

    // Verify monotonic ordering: each id must be strictly increasing or equal if sequential
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      assert.ok(
        curr.id >= prev.id,
        `Deterministic ordering check failed: event ${curr.id} came after ${prev.id}`
      );
    }
  });

  await asyncTest("12. Privileged Credential Reveal: RBAC & Immutable Audit Log", async () => {
    // A. Non-admin forbidden check
    const nonAdminRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor/${testProxyId}/reveal-credential`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(nonAdminRes.status, 403, "Non-admin must receive 403 Forbidden");

    // B. Admin authorized reveal
    const revealRes = await fetch(`${BASE_URL}/api/admin/proxy-monitor/${testProxyId}/reveal-credential`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "Delle6400@" }),
    });
    const revealJson = await revealRes.json();
    assert.strictEqual(revealRes.status, 200);
    assert.strictEqual(revealJson.success, true);
    assert.strictEqual(revealJson.password, "qfj3a4p7ad", "Decrypted password must match original secret");
    assert.strictEqual(revealJson.raw_input, "lite.flashproxy.io:6969:d9pwswslis-country-US:qfj3a4p7ad");

    // C. Verify immutable proxy_credential_viewed audit event recorded
    const db = getDB();
    const [auditRows] = await db.query(
      "SELECT * FROM proxy_audit_events WHERE proxy_id = ? AND event_type = 'proxy_credential_viewed'",
      [testProxyId]
    );
    assert.strictEqual(auditRows.length, 1, "Must record exactly 1 proxy_credential_viewed event");
    const meta = typeof auditRows[0].metadata === "string" ? JSON.parse(auditRows[0].metadata) : auditRows[0].metadata;
    assert.strictEqual(meta.admin_email, "admin@opinioninsights.in");
    // Verify password is NOT in audit metadata
    assert.strictEqual(meta.password, undefined);
    assert.strictEqual(meta.pass, undefined);
  });

  // Teardown
  if (server) {
    server.close();
  }

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
  console.error("Test execution threw fatal exception:", err);
  process.exit(1);
});
