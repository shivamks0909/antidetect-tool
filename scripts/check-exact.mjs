import fs from "fs";

const pakPath = "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak";
const buf = fs.readFileSync(pakPath);

const resourceCount = buf.readUInt16LE(8);
const aliasCount = buf.readUInt16LE(10);

let offset = 12;
const entries = [];
for (let i = 0; i <= resourceCount; i++) {
  const id = buf.readUInt16LE(offset);
  const dataOffset = buf.readUInt32LE(offset + 2);
  entries.push({ id, dataOffset });
  offset += 6;
}

const exactMatches = [];
for (let i = 0; i < resourceCount; i++) {
  const start = entries[i].dataOffset;
  const end = entries[i + 1].dataOffset;
  const slice = buf.subarray(start, end);
  const str = slice.toString("utf8");
  if (str === "ShardX") {
    exactMatches.push({ id: entries[i].id, index: i });
  }
}

console.log("Exact 'ShardX' entries:", exactMatches);
