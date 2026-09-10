import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);

const target = "<title>ShardX Browser</title>";
const pos = buf.indexOf(target);

if (pos !== -1) {
  // Find start of <!DOCTYPE html>
  const docStart = buf.lastIndexOf("<!DOCTYPE html>", pos);
  // Find end </html>
  const docEnd = buf.indexOf("</html>", pos) + 7;
  console.log("HTML length:", docEnd - docStart);
  console.log(buf.subarray(docStart, docEnd).toString("utf8"));
}
