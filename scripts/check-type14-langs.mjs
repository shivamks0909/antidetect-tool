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

function parseDir(dirOffset) {
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
      const strOffset = rsrcSec.offset + (nameOrId & 0x7fffffff);
      const strLen = buf.readUInt16LE(strOffset);
      name = buf.subarray(strOffset + 2, strOffset + 2 + strLen * 2).toString("utf16le");
    } else {
      name = `${nameOrId}`;
    }

    const isSubdir = (dataOrSubdir & 0x80000000) !== 0;
    const offset = rsrcSec.offset + (dataOrSubdir & 0x7fffffff);
    entries.push({ name, isSubdir, offset });
  }
  return entries;
}

const rootEntries = parseDir(rsrcSec.offset);
const type14 = rootEntries.find(e => e.name === "14");
if (type14) {
  const names = parseDir(type14.offset);
  for (const n of names) {
    const langs = parseDir(n.offset);
    console.log(`Type 14, Name: ${n.name}, Langs:`, langs.map(l => l.name));
  }
}
