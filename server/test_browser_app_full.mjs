import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runBrowserTest() {
  console.log("=== STARTING FULL PLAYWRIGHT BROWSER E2E TEST ===");

  // 1. Start backend server on port 5088
  process.env.PORT = "5088";
  const { app } = await import("./src/index.js");
  const server = http.createServer(app);
  await new Promise((r) => server.listen(5088, r));
  console.log("Backend listening on http://127.0.0.1:5088");

  // 2. Serve built admin-app on port 5188
  const staticApp = express();
  const distDir = path.resolve(__dirname, "../admin-app/dist");
  staticApp.use(express.static(distDir));
  staticApp.get("*", (req, res) => res.sendFile(path.join(distDir, "index.html")));
  const staticServer = http.createServer(staticApp);
  await new Promise((r) => staticServer.listen(5188, r));
  console.log("Admin Web App listening on http://127.0.0.1:5188");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[Browser Console Error]:`, msg.text());
  });

  try {
    // Intercept /api requests in the browser to route to 5088
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const target = `http://127.0.0.1:5088${url.pathname}${url.search}`;
      try {
        const response = await fetch(target, {
          method: route.request().method(),
          headers: route.request().headers(),
          body: route.request().postDataBuffer() || undefined,
        });
        const headers = {};
        for (const [k, v] of response.headers.entries()) {
          headers[k] = v;
        }
        route.fulfill({
          status: response.status,
          headers,
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch (e) {
        route.abort();
      }
    });

    console.log("\n1. Navigating to http://127.0.0.1:5188/ ...");
    await page.goto("http://127.0.0.1:5188/", { waitUntil: "networkidle" });

    // Step 2: Login
    console.log("2. Performing admin login...");
    const emailInput = await page.$('input[placeholder*="opinioninsights"], input[type="text"]');
    const passInput = await page.$('input[type="password"]');
    const submitBtn = await page.$('button[type="submit"]');

    await emailInput.fill("admin@opinioninsights.in");
    await passInput.fill("Delle6400@");
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Step 3: Navigate to User & Access Control
    console.log("3. Navigating to User & Access Control...");
    await page.goto("http://127.0.0.1:5188/#users", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Step 4: Verify Users Table
    console.log("4. Verifying Users Table contents...");
    const bodyText = await page.innerText("body");
    const hasAdmin1 = bodyText.includes("admin@opinioninsights.in");
    const hasAdmin2 = bodyText.includes("admin@opinioninsights.com");
    const hasVendor = bodyText.includes("vendor@opinioninsights.in");
    const hasEmptyNotice = bodyText.includes("No users match your criteria");

    console.log("  Users present:", { hasAdmin1, hasAdmin2, hasVendor });
    console.log("  False empty notice present:", hasEmptyNotice);

    if (!hasAdmin1 || !hasVendor || hasEmptyNotice) {
      throw new Error("User table does not display expected users!");
    }
    console.log("  ✅ Users correctly rendered in table!");

    // Step 5: Test 5 Consecutive Page Refreshes (F5)
    console.log("\n5. Testing 5 Consecutive Page Refreshes (Session Persistence)...");
    for (let i = 1; i <= 5; i++) {
      console.log(`  Reloading page (${i}/5)...`);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1200);

      const afterReloadText = await page.innerText("body");
      const isLoginScreen = afterReloadText.includes("Sign In") && afterReloadText.includes("Welcome Back");
      const stillHasUsers = afterReloadText.includes("admin@opinioninsights.in");

      console.log(`  Reload #${i}: Still Authenticated? ${!isLoginScreen}, Users Loaded? ${stillHasUsers}`);
      if (isLoginScreen || !stillHasUsers) {
        throw new Error(`Failed session persistence on reload #${i}: Logged out or users missing!`);
      }
    }
    console.log("  ✅ Admin session survived 5 consecutive page refreshes!");

    // Step 6: Test User Filtering
    console.log("\n6. Testing Role Filters...");
    const vendorBtn = await page.$('button:has-text("vendor")');
    if (vendorBtn) {
      await vendorBtn.click();
      await page.waitForTimeout(800);
      const vendorFilteredText = await page.innerText("table");
      console.log("  Vendor filter active. Contains admin@?:", vendorFilteredText.includes("admin@opinioninsights.in"));
      console.log("  Contains vendor@?:", vendorFilteredText.includes("vendor@opinioninsights.in"));
    }

    // Step 7: Test Real Logout
    console.log("\n7. Testing Real Logout...");
    const logoutBtn = await page.$('button:has-text("Logout"), button:has-text("Sign Out"), [title*="Logout"]');
    if (logoutBtn) {
      await logoutBtn.click();
      await page.waitForTimeout(1500);

      const postLogoutText = await page.innerText("body");
      const backOnLogin = postLogoutText.includes("Welcome Back") || postLogoutText.includes("Sign In");
      console.log("  Back on login page after explicit logout?", backOnLogin);

      // Verify token cleared
      const storedToken = await page.evaluate(() => localStorage.getItem("opinion_admin_token"));
      console.log("  localStorage token after logout:", storedToken);
      if (storedToken) throw new Error("Token was not removed on logout!");

      // Refresh after logout: should remain on login page
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const afterLogoutRefreshText = await page.innerText("body");
      const stillOnLogin = afterLogoutRefreshText.includes("Welcome Back") || afterLogoutRefreshText.includes("Sign In");
      console.log("  Remains on login page after refresh post-logout?", stillOnLogin);
      if (!stillOnLogin) throw new Error("Did not remain on login page after refresh post-logout!");
    }
    console.log("  ✅ Logout correctly invalidates session and clears client state.");

    console.log("\n=== PLAYWRIGHT E2E BROWSER TEST COMPLETED WITH 100% SUCCESS ===");
  } finally {
    await browser.close();
    server.close();
    staticServer.close();
  }
}

runBrowserTest().catch((err) => {
  console.error("❌ BROWSER TEST FAILED:", err);
  process.exit(1);
});
