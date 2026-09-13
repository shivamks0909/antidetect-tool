import { connectDB, autoFixDatabase, getDB, closeDb } from "../src/db.js";
import bcrypt from "bcryptjs";

async function main() {
  console.log("=================================================");
  console.log("  OPINION INSIGHTS - DATABASE & AUTH AUTO-FIXER  ");
  console.log("=================================================\n");

  try {
    console.log("[1/4] Connecting to Database layer...");
    const db = await connectDB();
    console.log(`[OK] Connected. Active engine: ${db.getEngine().toUpperCase()}`);

    console.log("\n[2/4] Executing autoFixDatabase() self-healing routine...");
    const report = await autoFixDatabase();
    console.log("[OK] Schema & user verification actions completed:");
    report.actions.forEach(a => console.log(`  - ${a}`));

    console.log("\n[3/4] Verifying admin accounts & credentials...");
    const testAccounts = [
      { email: "admin@opinioninsights.in", password: "Delle6400@" },
      { email: "admin@opinioninsights.com", password: "Delle6400@" },
    ];

    for (const acc of testAccounts) {
      const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [acc.email]);
      if (rows.length === 0) {
        throw new Error(`Account ${acc.email} missing after auto-fix!`);
      }
      const user = rows[0];
      const match = await bcrypt.compare(acc.password, user.passwordHash);
      if (!match) {
        throw new Error(`Password verification failed for ${acc.email}`);
      }
      console.log(`[OK] Verified: ${acc.email} (Role: ${user.role}, Active: ${user.isActive}, FailedAttempts: ${user.failedAttempts})`);
    }

    console.log("\n[4/4] Verifying session tracking table...");
    await db.query("DELETE FROM active_sessions WHERE isRevoked = 1 AND revokedAt < datetime('now', '-30 days')");
    console.log("[OK] Active sessions table ready.");

    console.log("\n=================================================");
    console.log("  RESULT: DATABASE AUTH LOGIN PERMANENTLY FIXED!  ");
    console.log(`  Engine:   ${db.getEngine().toUpperCase()}`);
    console.log(`  Admin:    admin@opinioninsights.in / Delle6400@`);
    console.log(`  Alias:    admin@opinioninsights.com / Delle6400@`);
    console.log("=================================================\n");

    await closeDb();
    process.exit(0);
  } catch (err) {
    console.error("\n[ERROR] Auto-fix failed:", err.message);
    process.exit(1);
  }
}

main();
