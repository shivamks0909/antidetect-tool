import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { readPak } from "./pak-tool.mjs";

console.log("==================================================================");
console.log("   OPINION INSIGHTS BROWSER: RUNTIME BRANDING VERIFICATION        ");
console.log("==================================================================\n");

let passCount = 0;
let failCount = 0;

function assert(condition, name, details = "") {
  if (condition) {
    passCount++;
    console.log(`[PASS] ${name}${details ? " - " + details : ""}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name}${details ? " - " + details : ""}`);
  }
}

const roamingDir = path.join(process.env.APPDATA, "opinion-insights-browser");
const runtimeExe = path.join(roamingDir, "runtime", "Opinion-Insights-Engine", "chrome.exe");
const runtimeDll = path.join(roamingDir, "runtime", "Opinion-Insights-Engine", "chrome.dll");
const localePak = path.join(roamingDir, "runtime", "Opinion-Insights-Engine", "locales", "en-US.pak");

// 1. Executable PE Verification
console.log("--- 1. EXECUTABLE PE METADATA VERIFICATION ---");
assert(fs.existsSync(runtimeExe), "Chromium Executable Exists", runtimeExe);

const viRaw = execSync(`powershell -Command "[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${runtimeExe.replace(/'/g, "''")}') | Select-Object -Property FileDescription, ProductName, CompanyName | ConvertTo-Json"`, { encoding: "utf8" });
const vi = JSON.parse(viRaw);

assert(vi.FileDescription === "Opinion Insights Browser", "FileDescription Branding", vi.FileDescription);
assert(vi.ProductName === "Opinion Insights Browser", "ProductName Branding", vi.ProductName);
assert(vi.CompanyName === "Opinion Insights LLC", "CompanyName Branding", vi.CompanyName);

// 2. DLL Embedded Branding Verification
console.log("\n--- 2. CHROMIUM DLL WELCOME PAGE BRANDING ---");
assert(fs.existsSync(runtimeDll), "Chromium DLL Exists", runtimeDll);
const dllBuf = fs.readFileSync(runtimeDll);
assert(!dllBuf.includes("<title>ShardX Browser</title>"), "Old ShardX Welcome Title Removed");
assert(dllBuf.includes("<title>Opinion Insights Browser</title>"), "New Opinion Insights Welcome Title Present");
assert(dllBuf.includes("<h1>Opinion Insights <span class=\"accent\">Browser</span></h1>"), "New Welcome Heading Present");

// 3. Locales PAK String Table Verification
console.log("\n--- 3. LOCALES PAK STRING TABLE VERIFICATION ---");
assert(fs.existsSync(localePak), "en-US.pak Exists", localePak);
const pakBuf = fs.readFileSync(localePak);
const pak = readPak(pakBuf);

const res101 = pak.resources.find(r => r.id === 101);
assert(Boolean(res101), "Resource ID 101 (IDS_PRODUCT_NAME) exists");
const res101Text = res101 ? res101.data.toString("utf8") : "";
assert(res101Text === "Opinion Insights Browser", "Resource ID 101 Value", res101Text);

const res475 = pak.resources.find(r => r.id === 475);
assert(Boolean(res475), "Resource ID 475 (IDS_BROWSER_WINDOW_TITLE_FORMAT) exists");
const res475Text = res475 ? res475.data.toString("utf8") : "";
assert(res475Text === "$1 - Opinion Insights Browser", "Resource ID 475 Value", res475Text);

let pakShardXCount = 0;
for (const r of pak.resources) {
  if (r.data.toString("utf8").includes("ShardX")) {
    pakShardXCount++;
  }
}
assert(pakShardXCount === 0, "Zero ShardX Strings in en-US.pak", `Count: ${pakShardXCount}`);

// 4. Live Browser Launch & Window Title Inspection
console.log("\n--- 4. LIVE DESKTOP CHROMIUM WINDOW TITLE TEST ---");
const tempUdd = path.join(process.env.TEMP, `oi_verify_${Date.now()}`);
fs.mkdirSync(tempUdd, { recursive: true });

// Create minimal fingerprint.json
const fpPath = path.join(tempUdd, "fingerprint.json");
fs.writeFileSync(fpPath, JSON.stringify({
  navigator: { user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36" }
}));

const child = spawn(runtimeExe, [
  `--user-data-dir=${tempUdd}`,
  `--fingerprint-profile=${fpPath}`,
  "--no-first-run",
  "--no-default-browser-check"
], { detached: true, stdio: "ignore" });

console.log(`Spawned test browser process PID: ${child.pid}`);

// Wait for window to render and inspect window title
let windowTitle = "";
for (let attempt = 0; attempt < 12; attempt++) {
  execSync("powershell -Command \"Start-Sleep -Milliseconds 600\"");
  try {
    const titleCheck = execSync(`powershell -Command "(Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle"`, { encoding: "utf8" }).trim();
    if (titleCheck) {
      windowTitle = titleCheck;
      break;
    }
  } catch (err) {
    // continue polling
  }
}

console.log("Captured Chromium Desktop Window Title:", JSON.stringify(windowTitle));
assert(windowTitle.includes("Opinion Insights Browser"), "Window Title Contains New Branding", windowTitle);
assert(!windowTitle.includes("ShardX"), "Window Title Does Not Contain ShardX", windowTitle);

// Clean up test child
try {
  execSync("taskkill /F /IM chrome.exe", { stdio: "ignore" });
} catch {}
try {
  fs.rmSync(tempUdd, { recursive: true, force: true });
} catch {}

console.log("\n==================================================================");
console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log("==================================================================");

if (failCount > 0) {
  process.exit(1);
}
