import fs from "fs";
import path from "path";

const directories = [
  "src-tauri/resources/Opinion-Insights-Engine/locales",
  path.join(process.env.APPDATA, "opinion-insights-browser", "runtime", "Opinion-Insights-Engine", "locales"),
];

let remainingCount = 0;
for (const dir of directories) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".pak"));
  for (const f of files) {
    const full = path.join(dir, f);
    const content = fs.readFileSync(full);
    if (content.includes("ShardX")) {
      console.log(`Found ShardX in ${full}`);
      remainingCount++;
    }
  }
}

console.log(`Total remaining locale files containing 'ShardX': ${remainingCount}`);
