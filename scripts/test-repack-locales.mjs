import fs from "fs";
import { readPak, writePak } from "./pak-tool.mjs";

const testPath = "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak";
const buf = fs.readFileSync(testPath);
const pak = readPak(buf);

let modifiedCount = 0;
for (const res of pak.resources) {
  let str = res.data.toString("utf8");
  if (str.includes("ShardX")) {
    modifiedCount++;
    const original = str;
    str = str.replaceAll("ShardX Browser", "Opinion Insights Browser");
    str = str.replaceAll("ShardX", "Opinion Insights Browser");
    res.data = Buffer.from(str, "utf8");
    if (modifiedCount <= 5) {
      console.log(`[Res ID ${res.id}]`);
      console.log("  BEFORE:", original);
      console.log("  AFTER: ", str);
    }
  }
}

console.log(`Total modified resources in en-US.pak: ${modifiedCount}`);
const newBuf = writePak(pak);
console.log(`Original size: ${buf.length}, New size: ${newBuf.length}`);

// Verify round-trip re-reading of newBuf
const verified = readPak(newBuf);
console.log(`Verified re-read: ${verified.resources.length} resources, ${verified.aliases.length} aliases.`);
// Check if any ShardX remains in verified
let remaining = 0;
for (const res of verified.resources) {
  if (res.data.toString("utf8").includes("ShardX")) {
    remaining++;
  }
}
console.log(`Remaining 'ShardX' in repacked en-US.pak: ${remaining}`);
