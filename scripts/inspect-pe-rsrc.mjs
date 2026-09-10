import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

// Find PE header
const peOffset = buf.readUInt32LE(0x3c);
console.log("PE offset:", peOffset.toString(16));

const magic = buf.readUInt16LE(peOffset + 24);
console.log("Optional Header Magic:", magic.toString(16)); // 20b for PE32+ (64-bit)

// Data Directory index 2 is Resource Table: offset at peOffset + 24 + 112 (for PE32+)
const rsrcRva = buf.readUInt32LE(peOffset + 24 + 112);
const rsrcSize = buf.readUInt32LE(peOffset + 24 + 116);
console.log(`Resource Table: RVA=0x${rsrcRva.toString(16)}, Size=0x${rsrcSize.toString(16)}`);

// Find section containing rsrcRva
const numSections = buf.readUInt16LE(peOffset + 6);
const optHeaderSize = buf.readUInt16LE(peOffset + 20);
const sectionTableOffset = peOffset + 24 + optHeaderSize;

let rsrcSection = null;
for (let i = 0; i < numSections; i++) {
  const sOffset = sectionTableOffset + i * 40;
  const sName = buf.subarray(sOffset, sOffset + 8).toString("ascii").replace(/\0.*$/, "");
  const sVSize = buf.readUInt32LE(sOffset + 8);
  const sVRva = buf.readUInt32LE(sOffset + 12);
  const sRSize = buf.readUInt32LE(sOffset + 16);
  const sROffset = buf.readUInt32LE(sOffset + 20);
  console.log(`Section ${sName}: RVA=0x${sVRva.toString(16)}, RawOffset=0x${sROffset.toString(16)}, RawSize=0x${sRSize.toString(16)}`);
  if (rsrcRva >= sVRva && rsrcRva < sVRva + sVSize) {
    rsrcSection = { name: sName, rva: sVRva, offset: sROffset, size: sRSize };
  }
}

console.log("Resource section:", rsrcSection);
