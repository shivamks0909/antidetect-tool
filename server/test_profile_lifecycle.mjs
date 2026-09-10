import { MongoClient } from "mongodb";

const BASE_URL = process.env.API_BASE || "https://api.opinioninsights.in";
const MONGODB_URI = "mongodb+srv://cypher1446_db_user:1DddU8Z92l7dxNbn@cluster0.kopsso3.mongodb.net/?appName=Cluster0";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runRegressionSuite() {
  console.log("================================================================");
  console.log("   PROFILE LIFECYCLE & REGRESSION SUITE (STRICT ZERO-AUTO-SEED) ");
  console.log("================================================================\n");

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db("opinion_insights");

  // Helper to query profiles from backend API
  async function apiGetProfiles(token) {
    const res = await fetch(`${BASE_URL}/api/data/profiles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GET /api/data/profiles failed with ${res.status}`);
    const data = await res.json();
    return data.profiles || [];
  }

  // Helper to create profile via backend API
  async function apiCreateProfile(token, profilePayload) {
    const res = await fetch(`${BASE_URL}/api/data/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(profilePayload),
    });
    if (!res.ok) throw new Error(`POST /api/data/profiles failed with ${res.status}`);
    const data = await res.json();
    return data.profile;
  }

  // Helper to delete profile via backend API
  async function apiDeleteProfile(token, profileId) {
    const res = await fetch(`${BASE_URL}/api/data/profiles/${profileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`DELETE /api/data/profiles/${profileId} failed with ${res.status}`);
    const data = await res.json();
    return data;
  }

  // Helper to login
  async function login(email, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(`Login failed for ${email}: ${data.error}`);
    return { token: data.token, user: data.user };
  }

  const testAccounts = [
    { name: "ADMIN", email: "admin@opinioninsights.com", pass: "AdminPassword123!" },
    { name: "USER", email: "bunny@panelflow.com", pass: "Delle6400@@@@@@@@" },
  ];

  for (const account of testAccounts) {
    console.log(`\n>>> Testing Account: [${account.name}] ${account.email}`);

    // 1. Authenticate
    const auth = await login(account.email, account.pass);
    const token = auth.token;
    const userId = auth.user.id;
    console.log(`  [+] Logged in successfully. User ID: ${userId}`);

    // Ensure clean state before test run
    await db.collection("profile_metas").deleteMany({
      $or: [{ owner_account_id: userId }, { userId: userId }],
    });
    await db.collection("profiles").deleteMany({
      $or: [{ owner_account_id: userId }, { userId: userId }],
    });

    // 2. Fresh state check: must start with 0 profiles
    let profiles = await apiGetProfiles(token);
    console.log(`  [1] Fresh login profiles count: ${profiles.length} (Expected: 0)`);
    if (profiles.length !== 0) {
      throw new Error(`FAILURE: Fresh account started with ${profiles.length} profiles instead of 0!`);
    }

    // 3. Simulated dashboard load, refresh, and restart
    console.log(`  [2] Simulating dashboard load and multiple refreshes...`);
    for (let r = 1; r <= 3; r++) {
      await sleep(1000);
      profiles = await apiGetProfiles(token);
      if (profiles.length !== 0) {
        throw new Error(`FAILURE: Profile appeared after refresh #${r}! Count: ${profiles.length}`);
      }
    }
    console.log(`  [+] After 3 refreshes, profile count is STILL 0.`);

    // 4. Manually create EXACTLY 1 profile
    const profileId = `profile-test-${Date.now()}`;
    console.log(`  [3] Manually creating exactly 1 profile (ID: ${profileId})...`);
    const createdProfile = await apiCreateProfile(token, {
      id: profileId,
      name: `Intentional Profile - ${account.name}`,
      notes: "Created explicitly by test suite",
      _meta: { id: profileId },
    });
    console.log(`  [+] Profile created: "${createdProfile.name}"`);

    // Verify count is exactly 1
    profiles = await apiGetProfiles(token);
    console.log(`  [4] Profile count after creation: ${profiles.length} (Expected: 1)`);
    if (profiles.length !== 1) {
      throw new Error(`FAILURE: Expected 1 profile, but found ${profiles.length}!`);
    }

    // 5. Wait 30 seconds with repeated polling to prove NO duplicate/phantom profiles are spawned
    console.log(`  [5] Waiting 30 seconds with continuous polling to observe stability...`);
    for (let sec = 5; sec <= 30; sec += 5) {
      await sleep(5000);
      profiles = await apiGetProfiles(token);
      process.stdout.write(`       -> At ${sec}s: count = ${profiles.length}\n`);
      if (profiles.length !== 1) {
        throw new Error(`FAILURE: Profile count changed at ${sec}s! Found ${profiles.length} profiles instead of 1.`);
      }
    }
    console.log(`  [+] Stability verified: Profile count remained exactly 1 throughout the 30-second window.`);

    // 6. Delete that 1 profile
    console.log(`  [6] Deleting the profile (ID: ${profileId})...`);
    const delResult = await apiDeleteProfile(token, profileId);
    console.log(`  [+] Deleted count: ${delResult.deletedCount}`);

    // Verify count is 0 immediately after deletion
    profiles = await apiGetProfiles(token);
    console.log(`  [7] Profile count immediately after delete: ${profiles.length} (Expected: 0)`);
    if (profiles.length !== 0) {
      throw new Error(`FAILURE: Expected 0 profiles after delete, but found ${profiles.length}!`);
    }

    // 7. Verify post-delete stability across refreshes/restarts (no resurrection)
    console.log(`  [8] Waiting and refreshing post-deletion to verify NO recreation...`);
    for (let r = 1; r <= 3; r++) {
      await sleep(2000);
      profiles = await apiGetProfiles(token);
      if (profiles.length !== 0) {
        throw new Error(`FAILURE: Profile resurrected after post-delete refresh #${r}! Found ${profiles.length}.`);
      }
    }
    console.log(`  [+] Post-deletion verified: Profile count remained 0 across all refreshes without recreation.`);
  }

  // 8. Cross-Account Multi-Tenant Isolation Verification
  console.log(`\n>>> Verifying Strict Cross-Account Isolation...`);
  const adminAuth = await login("admin@opinioninsights.com", "AdminPassword123!");
  const userAuth = await login("bunny@panelflow.com", "Delle6400@@@@@@@@");

  // Create 1 profile for User
  const userProfId = `user-isolated-${Date.now()}`;
  await apiCreateProfile(userAuth.token, {
    id: userProfId,
    name: "User Private Profile",
    _meta: { id: userProfId },
  });

  // Admin checks profiles
  const adminProfiles = await apiGetProfiles(adminAuth.token);
  console.log(`  [+] Admin profile count: ${adminProfiles.length} (Expected: 0)`);
  if (adminProfiles.length !== 0) {
    throw new Error(`ISOLATION FAILURE: Admin can see User's profile!`);
  }

  // User checks profiles
  const userProfiles = await apiGetProfiles(userAuth.token);
  console.log(`  [+] User profile count: ${userProfiles.length} (Expected: 1)`);
  if (userProfiles.length !== 1 || userProfiles[0].id !== userProfId) {
    throw new Error(`ISOLATION FAILURE: User profile missing or mismatched!`);
  }

  // Clean up User's profile
  await apiDeleteProfile(userAuth.token, userProfId);
  const userAfterDel = await apiGetProfiles(userAuth.token);
  console.log(`  [+] User profile cleaned up: remaining = ${userAfterDel.length} (Expected: 0)`);

  await client.close();

  console.log("\n================================================================");
  console.log("   ALL REGRESSION CHECKS PASSED: ZERO AUTO-SEED / ZERO RECREATION");
  console.log("================================================================\n");
}

runRegressionSuite().catch((err) => {
  console.error("\n*** REGRESSION TEST FAILED ***\n", err);
  process.exit(1);
});
