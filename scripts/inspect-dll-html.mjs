import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);

const target = "<title>ShardX Browser</title>";
const pos = buf.indexOf(target);
console.log("Position in chrome.dll:", pos);

if (pos !== -1) {
  const start = Math.max(0, pos - 200);
  const end = Math.min(buf.length, pos + 400);
  console.log("HTML context:\n", buf.subarray(start, end).toString("utf8"));
}
