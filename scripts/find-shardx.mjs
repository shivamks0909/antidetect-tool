import fs from "fs";
import path from "path";

const dir = "src-tauri/resources/Opinion-Insights-Engine";
if (!fs.existsSync(dir)) {
  console.log("Directory does not exist:", dir);
  process.exit(0);
}

function searchFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const str = buf.toString("latin1");
    const matches = str.match(/ShardX[A-Za-z0-9_ -]*/gi);
    if (matches && matches.length > 0) {
      const unique = Array.from(new Set(matches));
      console.log(filePath, "found matches:", unique.slice(0, 10));
    }
  } catch (err) {
    console.error("Error reading", filePath, err.message);
  }
}

function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const full = path.join(d, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (f.endsWith(".pak") || f.endsWith(".manifest") || f.endsWith(".json") || f.endsWith(".exe") || f.endsWith(".dll")) {
      searchFile(full);
    }
  }
}

console.log("Searching for ShardX in engine...");
walk(dir);
console.log("Done.");
