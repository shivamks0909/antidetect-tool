import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

const peOffset = buf.readUInt32LE(0x3c);
const optHeaderSize = buf.readUInt16LE(peOffset + 20);
const numSections = buf.readUInt16LE(peOffset + 6);
const secTableOffset = peOffset + 24 + optHeaderSize;

let rsrcSec = null;
for (let i = 0; i < numSections; i++) {
  const sOffset = secTableOffset + i * 40;
  const sName = buf.subarray(sOffset, sOffset + 8).toString("ascii").replace(/\0.*$/, "");
  if (sName === ".rsrc") {
    rsrcSec = {
      rva: buf.readUInt32LE(sOffset + 12),
      offset: buf.readUInt32LE(sOffset + 20),
      size: buf.readUInt32LE(sOffset + 16)
    };
    break;
  }
}

console.log("RSRC section:", rsrcSec);

function rvaToOffset(rva) {
  return rsrcSec.offset + (rva - rsrcSec.rva);
}

// Resource directory table
function parseDir(dirOffset, level = 0) {
  const numNamed = buf.readUInt16LE(dirOffset + 12);
  const numId = buf.readUInt16LE(dirOffset + 14);
  const entries = [];
  let entryOffset = dirOffset + 16;
  for (let i = 0; i < numNamed + numId; i++) {
    const nameOrId = buf.readUInt32LE(entryOffset);
    const dataOrSubdir = buf.readUInt32LE(entryOffset + 4);
    entryOffset += 8;

    let name = "";
    if (nameOrId & 0x80000000) {
      // String name: offset from rsrcSec.offset
      const strOffset = rsrcSec.offset + (nameOrId & 0x7fffffff);
      const strLen = buf.readUInt16LE(strOffset);
      name = buf.subarray(strOffset + 2, strOffset + 2 + strLen * 2).toString("utf16le");
    } else {
      name = `#${nameOrId}`;
    }

    const isSubdir = (dataOrSubdir & 0x80000000) !== 0;
    const offset = rsrcSec.offset + (dataOrSubdir & 0x7fffffff);
    entries.push({ name, isSubdir, offset });
  }
  return entries;
}

const rootEntries = parseDir(rsrcSec.offset, 0);
console.log("Root Resource Types:");
for (const typeEntry of rootEntries) {
  const typeId = typeEntry.name;
  console.log(`Type ${typeId}:`);
  const names = parseDir(typeEntry.offset, 1);
  for (const n of names) {
    const langs = parseDir(n.offset, 2);
    const dataEntryOffset = langs[0].offset;
    const dataRva = buf.readUInt32LE(dataEntryOffset);
    const dataSize = buf.readUInt32LE(dataEntryOffset + 4);
    console.log(`  Name: ${n.name}, Size: ${dataSize} bytes (RVA 0x${dataRva.toString(16)})`);
  }
}
