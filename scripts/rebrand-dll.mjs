import fs from "fs";
import path from "path";

const dllPaths = [
  "src-tauri/resources/Opinion-Insights-Engine/chrome.dll",
  path.join(process.env.APPDATA, "opinion-insights-browser", "runtime", "Opinion-Insights-Engine", "chrome.dll"),
];

const targetHeader = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>ShardX Browser</title>";

for (const dllPath of dllPaths) {
  if (!fs.existsSync(dllPath)) {
    console.log("File does not exist, skipping:", dllPath);
    continue;
  }
  console.log("Patching chrome.dll at:", dllPath);
  const buf = fs.readFileSync(dllPath);
  const pos = buf.indexOf(Buffer.from(targetHeader, "utf8"));
  if (pos === -1) {
    if (buf.indexOf(Buffer.from("<title>Opinion Insights Browser</title>", "utf8")) !== -1) {
      console.log("  Already patched with Opinion Insights Browser!");
    } else {
      console.warn("  Target HTML not found in", dllPath);
    }
    continue;
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
  if (diff < 0) {
    throw new Error(`New HTML length ${newLen} exceeds original length ${originalLen}`);
  }

  newHtml = newHtml.replace("</body>", " ".repeat(diff) + "</body>");
  const finalLen = Buffer.byteLength(newHtml, "utf8");
  if (finalLen !== originalLen) {
    throw new Error(`Padding mismatch: ${finalLen} vs ${originalLen}`);
  }

  Buffer.from(newHtml, "utf8").copy(buf, pos);
  fs.writeFileSync(dllPath, buf);
  console.log(`  Successfully patched ${dllPath} in-place!`);
}
