import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);
const str = buf.toString("latin1");

const regex = /shardx-[a-z0-9_-]+/gi;
const switches = new Set();
let m;
while ((m = regex.exec(str)) !== null) {
  switches.add(m[0]);
}

console.log("Found shardx- strings in chrome.dll:", Array.from(switches));
