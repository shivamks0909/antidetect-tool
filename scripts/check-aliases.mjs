import fs from "fs";

const pakPath = "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak";
const buf = fs.readFileSync(pakPath);

const resourceCount = buf.readUInt16LE(8);
const aliasCount = buf.readUInt16LE(10);

let offset = 12 + (resourceCount + 1) * 6;
const aliasesTo0 = [];
for (let i = 0; i < aliasCount; i++) {
  const id = buf.readUInt16LE(offset);
  const targetIndex = buf.readUInt16LE(offset + 2);
  if (targetIndex === 0) {
    aliasesTo0.push(id);
  }
  offset += 4;
}

console.log(`Aliases pointing to ID 101 (entry 0): count=${aliasesTo0.length}, IDs=`, aliasesTo0);
