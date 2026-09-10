import fs from "fs";
import path from "path";
import { readPak, writePak } from "./pak-tool.mjs";

const directories = [
  "src-tauri/resources/Opinion-Insights-Engine/locales",
  path.join(process.env.APPDATA, "opinion-insights-browser", "runtime", "Opinion-Insights-Engine", "locales"),
  path.join(process.env.APPDATA, "opinion-insights-browser", "runtime", "ShardX-Windows", "locales")
];

function processPak(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const pak = readPak(buf);

    let changed = 0;
    for (const res of pak.resources) {
      let str = res.data.toString("utf8");
      if (str.includes("ShardX")) {
        changed++;
        str = str.replaceAll("ShardX Browser", "Opinion Insights Browser");
        str = str.replaceAll("ShardX", "Opinion Insights Browser");
        res.data = Buffer.from(str, "utf8");
      }
      if (res.id === 101) {
        // Ensure exact product name
        res.data = Buffer.from("Opinion Insights Browser", "utf8");
      }
    }

    if (changed > 0) {
      const outBuf = writePak(pak);
      fs.writeFileSync(filePath, outBuf);
      return { status: "updated", changed };
    }
    return { status: "unchanged", changed: 0 };
  } catch (err) {
    return { status: "error", error: err.message };
  }
}

console.log("Starting full locale pak rebranding...");
let totalUpdated = 0;
let totalFiles = 0;

for (const dir of directories) {
  if (!fs.existsSync(dir)) {
    console.log(`Directory does not exist, skipping: ${dir}`);
    continue;
  }
  console.log(`Processing directory: ${dir}`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pak"));
  for (const file of files) {
    totalFiles++;
    const fullPath = path.join(dir, file);
    const res = processPak(fullPath);
    if (res.status === "updated") {
      totalUpdated++;
    } else if (res.status === "error") {
      console.error(`  Error in ${file}: ${res.error}`);
    }
  }
}

console.log(`\nRebranding complete! Total files scanned: ${totalFiles}, Total updated: ${totalUpdated}`);
