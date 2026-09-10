import fs from "fs";
import path from "path";

const files = [
  "src-tauri/resources/Opinion-Insights-Engine/chrome.exe",
  "src-tauri/resources/Opinion-Insights-Engine/chrome.dll",
  "src-tauri/resources/Opinion-Insights-Engine/resources.pak",
  "src-tauri/resources/Opinion-Insights-Engine/chrome_100_percent.pak",
  "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak"
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log("Not found:", file);
    continue;
  }
  const buf = fs.readFileSync(file);
  const latin1 = buf.toString("latin1");
  const utf16le = buf.toString("utf16le");
  
  let countLatin = 0;
  let m;
  const reg1 = /ShardX[^\x00\r\n]{0,50}/g;
  console.log(`\n=== Checking ${file} (size: ${buf.length}) ===`);
  const matches = new Set();
  while ((m = reg1.exec(latin1)) !== null) {
    matches.add(m[0]);
    countLatin++;
    if (matches.size > 20) break;
  }
  console.log(`Found ~${countLatin} latin1 matches. Samples:`, Array.from(matches).slice(0, 10));

  const matches16 = new Set();
  const reg2 = /ShardX[^\x00\r\n]{0,50}/g;
  while ((m = reg2.exec(utf16le)) !== null) {
    matches16.add(m[0]);
    if (matches16.size > 20) break;
  }
  console.log(`Found utf16le matches. Samples:`, Array.from(matches16).slice(0, 10));
}
