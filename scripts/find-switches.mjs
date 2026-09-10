import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);
const str = buf.toString("latin1");

const regex = /--[a-z0-9_-]+/gi;
const switches = new Set();
let m;
while ((m = regex.exec(str)) !== null) {
  if (m[0].includes("shard") || m[0].includes("title") || m[0].includes("name") || m[0].includes("brand") || m[0].includes("product") || m[0].includes("app")) {
    switches.add(m[0]);
  }
}

console.log("Found matching switches in chrome.dll:");
for (const s of Array.from(switches).sort()) {
  console.log(s);
}
