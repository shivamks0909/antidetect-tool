import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

// Check strings in chrome.exe
const utf16 = buf.toString("utf16le");
const utf8 = buf.toString("utf8");

function findOccurrences(str, pattern) {
  const matches = [];
  let pos = 0;
  while ((pos = str.indexOf(pattern, pos)) !== -1) {
    matches.push(pos);
    pos += pattern.length;
  }
  return matches;
}

console.log("=== chrome.exe strings ===");
console.log("UTF16 'ShardX':", findOccurrences(utf16, "ShardX").length);
console.log("UTF8 'ShardX':", findOccurrences(utf8, "ShardX").length);

// Let's print the context around each UTF16 match
let pos = 0;
while ((pos = utf16.indexOf("ShardX", pos)) !== -1) {
  const start = Math.max(0, pos - 40);
  const end = Math.min(utf16.length, pos + 50);
  console.log(`Match at ${pos}: ...${JSON.stringify(utf16.substring(start, end))}...`);
  pos += "ShardX".length;
}
