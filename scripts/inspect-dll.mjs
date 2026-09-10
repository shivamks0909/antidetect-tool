import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);

const utf16 = buf.toString("utf16le");
const utf8 = buf.toString("utf8");

function scan(str, encoding) {
  let pos = 0;
  let count = 0;
  while ((pos = str.indexOf("ShardX", pos)) !== -1) {
    count++;
    const start = Math.max(0, pos - 40);
    const end = Math.min(str.length, pos + 60);
    console.log(`[${encoding}] Match ${count} at ${pos}: ${JSON.stringify(str.substring(start, end))}`);
    pos += "ShardX".length;
  }
}

console.log("=== chrome.dll UTF-16 strings ===");
scan(utf16, "utf-16");

console.log("=== chrome.dll UTF-8 strings ===");
scan(utf8, "utf-8");
