import fs from "fs";

const dllPath = "src-tauri/resources/Opinion-Insights-Engine/chrome.dll";
const buf = fs.readFileSync(dllPath);

const targetHeader = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>ShardX Browser</title>";
const pos = buf.indexOf(Buffer.from(targetHeader, "utf8"));
console.log("Target HTML found at pos:", pos);

if (pos === -1) {
  console.error("Target HTML header not found!");
  process.exit(1);
}

const endTag = Buffer.from("</html>\n", "utf8");
let endPos = buf.indexOf(endTag, pos);
if (endPos === -1) {
  const endTagNoNl = Buffer.from("</html>", "utf8");
  endPos = buf.indexOf(endTagNoNl, pos);
  endPos += endTagNoNl.length;
} else {
  endPos += endTag.length;
}

const originalHtml = buf.subarray(pos, endPos).toString("utf8");
const originalLen = Buffer.byteLength(originalHtml, "utf8");
console.log(`Original HTML length: ${originalLen} bytes`);

// Build replacement HTML
let newHtml = originalHtml;
newHtml = newHtml.replaceAll("<title>ShardX Browser</title>", "<title>Opinion Insights Browser</title>");
newHtml = newHtml.replaceAll("<h1>Shard<span class=\"accent\">X</span> Browser</h1>", "<h1>Opinion Insights <span class=\"accent\">Browser</span></h1>");
newHtml = newHtml.replaceAll("Anti-detect Chromium fork, built by the\n    <strong>proxyshard</strong> team.", "Enterprise Anti-detect Browser &bull; <strong>Opinion Insights</strong>.");
newHtml = newHtml.replaceAll("proxyshard offers", "We offer");
newHtml = newHtml.replaceAll("https://proxyshard.com", "https://opinioninsights.io");
newHtml = newHtml.replaceAll("&rarr; proxyshard.com", "&rarr; Opinion Insights");
newHtml = newHtml.replaceAll("Source &amp; documentation maintained by the proxyshard team.", "Opinion Insights Anti-detect Browser Runtime");

const newLen = Buffer.byteLength(newHtml, "utf8");
const diff = originalLen - newLen;
console.log(`New HTML length before padding: ${newLen} bytes (diff: ${diff})`);

if (diff < 0) {
  console.error("Error: New HTML is longer than original!");
  process.exit(1);
}

// Pad with spaces before </body>
newHtml = newHtml.replace("</body>", " ".repeat(diff) + "</body>");
const finalLen = Buffer.byteLength(newHtml, "utf8");
console.log(`Final HTML length: ${finalLen} bytes. Matches original: ${finalLen === originalLen}`);

if (finalLen !== originalLen) {
  console.error("Padding length mismatch!");
  process.exit(1);
}
console.log("HTML patch validated successfully!");
