import fs from "fs";

/**
 * Chromium Data Pack v5 reader and writer.
 */
export function readPak(buf) {
  const version = buf.readUInt32LE(0);
  if (version !== 5) {
    throw new Error(`Unsupported PAK version: ${version}`);
  }
  const encoding = buf.readUInt32LE(4); // 1 = UTF-8, 2 = UTF-16, 0 = BINARY
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

  const aliases = [];
  for (let i = 0; i < aliasCount; i++) {
    const id = buf.readUInt16LE(offset);
    const targetIndex = buf.readUInt16LE(offset + 2);
    aliases.push({ id, targetIndex });
    offset += 4;
  }

  const resources = [];
  for (let i = 0; i < resourceCount; i++) {
    const id = entries[i].id;
    const start = entries[i].dataOffset;
    const end = entries[i + 1].dataOffset;
    const data = Buffer.from(buf.subarray(start, end));
    resources.push({ id, data });
  }

  return { encoding, resources, aliases };
}

export function writePak({ encoding, resources, aliases }) {
  // Sort resources by id as required by Chromium binary search
  resources.sort((a, b) => a.id - b.id);
  // Sort aliases by id
  aliases.sort((a, b) => a.id - b.id);

  const resourceCount = resources.length;
  const aliasCount = aliases.length;

  // Header: 12 bytes
  // Entries: (resourceCount + 1) * 6 bytes
  // Aliases: aliasCount * 4 bytes
  const headerSize = 12;
  const entriesSize = (resourceCount + 1) * 6;
  const aliasesSize = aliasCount * 4;
  const dataStartOffset = headerSize + entriesSize + aliasesSize;

  let totalDataSize = 0;
  for (const r of resources) {
    totalDataSize += r.data.length;
  }

  const outBuf = Buffer.alloc(dataStartOffset + totalDataSize);

  // Write header
  outBuf.writeUInt32LE(5, 0);
  outBuf.writeUInt32LE(encoding, 4);
  outBuf.writeUInt16LE(resourceCount, 8);
  outBuf.writeUInt16LE(aliasCount, 10);

  let currentDataOffset = dataStartOffset;
  let entryOffset = 12;

  for (let i = 0; i < resourceCount; i++) {
    const r = resources[i];
    outBuf.writeUInt16LE(r.id, entryOffset);
    outBuf.writeUInt32LE(currentDataOffset, entryOffset + 2);
    entryOffset += 6;

    r.data.copy(outBuf, currentDataOffset);
    currentDataOffset += r.data.length;
  }

  // Sentinel entry (id = 0, offset = end of data)
  outBuf.writeUInt16LE(0, entryOffset);
  outBuf.writeUInt32LE(currentDataOffset, entryOffset + 2);
  entryOffset += 6;

  // Write aliases
  let aliasOffset = entryOffset;
  for (const a of aliases) {
    outBuf.writeUInt16LE(a.id, aliasOffset);
    outBuf.writeUInt16LE(a.targetIndex, aliasOffset + 2);
    aliasOffset += 4;
  }

  return outBuf;
}

// Test round-trip verification
const testPath = "src-tauri/resources/Opinion-Insights-Engine/locales/en-US.pak";
const originalBuf = fs.readFileSync(testPath);
const parsed = readPak(originalBuf);
console.log(`Parsed ${parsed.resources.length} resources, ${parsed.aliases.length} aliases.`);

const repackedBuf = writePak(parsed);
console.log(`Original size: ${originalBuf.length}, Repacked size: ${repackedBuf.length}`);
if (originalBuf.equals(repackedBuf)) {
  console.log("ROUND-TRIP SUCCESS: Repacked buffer is 100% bit-for-bit identical to original!");
} else {
  console.error("Mismatch in round-trip!");
  process.exit(1);
}
