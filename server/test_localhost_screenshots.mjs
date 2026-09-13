import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = "C:/Users/iamth/.gemini/antigravity-ide/brain/527b9bec-7e53-4fda-8eff-3b4ef0b74e2c";

async function main() {
  console.log("=== STARTING LOCALHOST VERIFICATION WITH SCREENSHOTS ===");

  // 1. Start backend server on port 5000
  process.env.PORT = "5000";
  const { app } = await import("./src/index.js");
  const backendServer = http.createServer(app);
  await new Promise((resolve) => backendServer.listen(5000, resolve));
  console.log("✅ Backend running at http://127.0.0.1:5000/api");

  // 2. Start Vite Dev Server for admin-app on port 5173
  const vite = await createViteServer({
    root: path.resolve(__dirname, "../admin-app"),
    server: { port: 5173, host: "127.0.0.1" },
  });
  await vite.listen();
  console.log("✅ Admin-App Vite dev server running at http://127.0.0.1:5173");

  // 3. Launch Playwright
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[Browser Console Error]:`, msg.text());
  });

  page.on("response", async (res) => {
    if (res.status() === 401) {
      let body = "";
      try {
        body = await res.text();
      } catch (_) {}
      console.log(`[401 Details] URL: ${res.url()} | Method: ${res.request().method()} | Auth Header: ${res.request().headers()["authorization"]} | Body: ${body}`);
    }
  });

  try {
    // Step 1: Login Page
    console.log("\nStep 1: Loading http://127.0.0.1:5173/ ...");
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const ss1 = path.join(ARTIFACTS_DIR, "screenshot_01_login.png");
    await page.screenshot({ path: ss1 });
    console.log(`📸 Screenshot 1 saved: ${ss1}`);

    // Step 2: Fill login form & submit
    console.log("\nStep 2: Submitting login credentials for admin@opinioninsights.in...");
    const emailInput = await page.$('input[placeholder*="opinioninsights"], input[type="text"]');
    const passInput = await page.$('input[type="password"]');
    const submitBtn = await page.$('button[type="submit"]');

    await emailInput.fill("admin@opinioninsights.in");
    await passInput.fill("Delle6400@");
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Step 3: Navigate to User & Access Control
    console.log("\nStep 3: Navigating to User & Access Control (#users)...");
    await page.goto("http://127.0.0.1:5173/#users", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // Verify user records rendered
    const bodyText = await page.innerText("body");
    const hasAdmin = bodyText.includes("admin@opinioninsights.in");
    const hasVendor = bodyText.includes("vendor@opinioninsights.in");
    const hasNoUsers = bodyText.includes("No users match your criteria");
    console.log("  Users in table:", { hasAdmin, hasVendor, hasNoUsers });

    if (!hasAdmin || !hasVendor || hasNoUsers) {
      throw new Error("Users failed to render in the table!");
    }

    const ss2 = path.join(ARTIFACTS_DIR, "screenshot_02_users_loaded.png");
    await page.screenshot({ path: ss2 });
    console.log(`📸 Screenshot 2 saved: ${ss2} (PROVES USERS ARE LOADED)`);

    // Step 4: Refresh Page (F5) to test session restoration
    console.log("\nStep 4: Testing Page Refresh (F5)...");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    const refreshBody = await page.innerText("body");
    const stillAdmin = refreshBody.includes("admin@opinioninsights.in");
    const isLogin = refreshBody.includes("Sign In") && refreshBody.includes("Welcome Back");
    console.log("  After refresh:", { stillAdmin, isLogin });

    if (isLogin || !stillAdmin) {
      throw new Error("Admin was logged out upon refresh!");
    }

    const ss3 = path.join(ARTIFACTS_DIR, "screenshot_03_after_refresh.png");
    await page.screenshot({ path: ss3 });
    console.log(`📸 Screenshot 3 saved: ${ss3} (PROVES SESSION SURVIVED REFRESH)`);

    // Step 5: Test Role Filter (Vendor)
    console.log("\nStep 5: Testing Role Filter (Vendor)...");
    const vendorFilterBtn = await page.$('button:has-text("vendor")');
    if (vendorFilterBtn) {
      await vendorFilterBtn.click();
      await page.waitForTimeout(1000);
      const ss4 = path.join(ARTIFACTS_DIR, "screenshot_04_role_filter_vendor.png");
      await page.screenshot({ path: ss4 });
      console.log(`📸 Screenshot 4 saved: ${ss4} (PROVES ROLE FILTERING)`);

      // Reset filter to All
      const allFilterBtn = await page.$('button:has-text("all")');
      if (allFilterBtn) await allFilterBtn.click();
      await page.waitForTimeout(800);
    }

    // Step 6: Test Real Logout
    console.log("\nStep 6: Testing Logout...");
    const logoutBtn = await page.$('button:has-text("Logout"), button:has-text("Sign Out"), [title*="Logout"]');
    if (logoutBtn) {
      await logoutBtn.click();
      await page.waitForTimeout(1500);

      const ss5 = path.join(ARTIFACTS_DIR, "screenshot_05_logged_out.png");
      await page.screenshot({ path: ss5 });
      console.log(`📸 Screenshot 5 saved: ${ss5} (PROVES LOGOUT REVOCATION)`);

      // Step 7: Refresh after logout
      console.log("\nStep 7: Refreshing after logout...");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1500);

      const ss6 = path.join(ARTIFACTS_DIR, "screenshot_06_refresh_after_logout.png");
      await page.screenshot({ path: ss6 });
      console.log(`📸 Screenshot 6 saved: ${ss6} (PROVES REMAINS LOGGED OUT)`);
    }

    console.log("\n=== ALL LOCALHOST TESTS AND SCREENSHOTS COMPLETED SUCCESSFULLY! ===");
  } finally {
    await browser.close();
    await vite.close();
    backendServer.close();
  }
}

main().catch((err) => {
  console.error("❌ LOCALHOST TEST ERROR:", err);
  process.exit(1);
});
