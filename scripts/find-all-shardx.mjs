import fs from "fs";
import path from "path";

const root = ".";
const ignoreDirs = new Set(["node_modules", "target", ".git", "dist", ".tauri"]);

const results = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(dir, entry.name);
      // Skip very large binary files in this text check, we checked engine binaries separately
      const stat = fs.statSync(fullPath);
      if (stat.size > 5 * 1024 * 1024) continue;
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (/shardx/i.test(line)) {
            results.push({ file: fullPath.replace(/\\/g, "/"), line: idx + 1, content: line.trim() });
          }
        });
      } catch {
        // binary file or non-utf8
      }
    }
  }
}

walk(root);

console.log(`Found ${results.length} occurrences of ShardX across the codebase:`);
for (const r of results) {
  console.log(`${r.file}:${r.line}: ${r.content.substring(0, 120)}`);
}
