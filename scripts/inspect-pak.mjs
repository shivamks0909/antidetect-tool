import fs from "fs";

const pakPath = "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak";
const buf = fs.readFileSync(pakPath);

const version = buf.readUInt32LE(0);
const encoding = buf.readUInt32LE(4);
const resourceCount = buf.readUInt16LE(8);
const aliasCount = buf.readUInt16LE(10);
console.log({ version, encoding, resourceCount, aliasCount });

let offset = 12;
const entries = [];
for (let i = 0; i <= resourceCount; i++) {
  const id = buf.readUInt16LE(offset);
  const dataOffset = buf.readUInt32LE(offset + 2);
  entries.push({ id, dataOffset });
  offset += 6;
}

const aliases = [];
for (let i = 0; i < aliasCount; i++) {
  const id = buf.readUInt16LE(offset);
  const targetIndex = buf.readUInt16LE(offset + 2);
  aliases.push({ id, targetIndex });
  offset += 4;
}

console.log(`Total entries: ${entries.length}, Total aliases: ${aliases.length}`);

const shardxEntries = [];
for (let i = 0; i < resourceCount; i++) {
  const start = entries[i].dataOffset;
  const end = entries[i + 1].dataOffset;
  const slice = buf.subarray(start, end);
  const str = slice.toString("utf8");
  if (str.includes("ShardX")) {
    shardxEntries.push({ id: entries[i].id, str });
  }
}

console.log(`Found ${shardxEntries.length} resources containing 'ShardX' in en-US.pak:`);
for (const item of shardxEntries) {
  console.log(`ID ${item.id}: ${JSON.stringify(item.str)}`);
}
