import fs from "fs";

function align4(buf, offset) {
  const pad = (4 - (offset % 4)) % 4;
  return offset + pad;
}

function writeStringEntry(key, val) {
  const keyBuf = Buffer.from(key + "\0", "utf16le");
  const valBuf = Buffer.from(val + "\0", "utf16le");
  
  // Header: 6 bytes (wLength, wValueLength, wType=1)
  const headerAndKeyLen = 6 + keyBuf.length;
  const valOffset = (headerAndKeyLen + 3) & ~3;
  const totalLen = valOffset + valBuf.length;
  const alignedTotalLen = (totalLen + 3) & ~3;

  const buf = Buffer.alloc(alignedTotalLen);
  buf.writeUInt16LE(totalLen, 0); // wLength
  buf.writeUInt16LE(val.length + 1, 2); // wValueLength (in words / characters including null)
  buf.writeUInt16LE(1, 4); // wType = 1 (Text)
  keyBuf.copy(buf, 6);
  valBuf.copy(buf, valOffset);

  return buf;
}

export function createVersionInfo(strings, fileVersion = "152.0.7977.65", productVersion = "152.0.7977.65") {
  // 1. StringTable children
  const stringBuffers = [];
  for (const [k, v] of Object.entries(strings)) {
    stringBuffers.push(writeStringEntry(k, v));
  }
  const stringTableChildren = Buffer.concat(stringBuffers);

  // StringTable header (key: "040904b0\0")
  const stKeyBuf = Buffer.from("040904b0\0", "utf16le");
  const stHeaderAndKey = 6 + stKeyBuf.length;
  const stChildrenOffset = (stHeaderAndKey + 3) & ~3;
  const stTotalLen = stChildrenOffset + stringTableChildren.length;
  const stAlignedLen = (stTotalLen + 3) & ~3;

  const stringTableBuf = Buffer.alloc(stAlignedLen);
  stringTableBuf.writeUInt16LE(stTotalLen, 0);
  stringTableBuf.writeUInt16LE(0, 2); // wValueLength = 0 for StringTable
  stringTableBuf.writeUInt16LE(1, 4); // wType = 1
  stKeyBuf.copy(stringTableBuf, 6);
  stringTableChildren.copy(stringTableBuf, stChildrenOffset);

  // StringFileInfo header (key: "StringFileInfo\0")
  const sfiKeyBuf = Buffer.from("StringFileInfo\0", "utf16le");
  const sfiHeaderAndKey = 6 + sfiKeyBuf.length;
  const sfiChildrenOffset = (sfiHeaderAndKey + 3) & ~3;
  const sfiTotalLen = sfiChildrenOffset + stringTableBuf.length;
  const sfiAlignedLen = (sfiTotalLen + 3) & ~3;

  const sfiBuf = Buffer.alloc(sfiAlignedLen);
  sfiBuf.writeUInt16LE(sfiTotalLen, 0);
  sfiBuf.writeUInt16LE(0, 2);
  sfiBuf.writeUInt16LE(1, 4);
  sfiKeyBuf.copy(sfiBuf, 6);
  stringTableBuf.copy(sfiBuf, sfiChildrenOffset);

  // VarFileInfo (Translation: 0x0409, 0x04b0 = en-US, Unicode)
  const varKeyBuf = Buffer.from("Translation\0", "utf16le");
  const varHeaderAndKey = 6 + varKeyBuf.length;
  const varValOffset = (varHeaderAndKey + 3) & ~3;
  const varValBuf = Buffer.alloc(4);
  varValBuf.writeUInt16LE(0x0409, 0);
  varValBuf.writeUInt16LE(0x04b0, 2);
  const varTotalLen = varValOffset + 4;
  const varAlignedLen = (varTotalLen + 3) & ~3;

  const varBuf = Buffer.alloc(varAlignedLen);
  varBuf.writeUInt16LE(varTotalLen, 0);
  varBuf.writeUInt16LE(4, 2); // 4 bytes of binary data
  varBuf.writeUInt16LE(0, 4); // wType = 0 (Binary)
  varKeyBuf.copy(varBuf, 6);
  varValBuf.copy(varBuf, varValOffset);

  // VarFileInfo wrapper
  const vfiKeyBuf = Buffer.from("VarFileInfo\0", "utf16le");
  const vfiHeaderAndKey = 6 + vfiKeyBuf.length;
  const vfiChildrenOffset = (vfiHeaderAndKey + 3) & ~3;
  const vfiTotalLen = vfiChildrenOffset + varBuf.length;
  const vfiAlignedLen = (vfiTotalLen + 3) & ~3;

  const vfiBuf = Buffer.alloc(vfiAlignedLen);
  vfiBuf.writeUInt16LE(vfiTotalLen, 0);
  vfiBuf.writeUInt16LE(0, 2);
  vfiBuf.writeUInt16LE(1, 4);
  vfiKeyBuf.copy(vfiBuf, 6);
  varBuf.copy(vfiBuf, vfiChildrenOffset);

  // VS_FIXEDFILEINFO (52 bytes)
  const ffi = Buffer.alloc(52);
  ffi.writeUInt32LE(0xfeef04bd, 0); // dwSignature
  ffi.writeUInt32LE(0x00010000, 4); // dwStrucVersion = 1.0
  const fvParts = fileVersion.split(".").map(Number);
  ffi.writeUInt16LE(fvParts[1] || 0, 8); // FileVersion Minor
  ffi.writeUInt16LE(fvParts[0] || 0, 10); // FileVersion Major
  ffi.writeUInt16LE(fvParts[3] || 0, 12); // FileVersion Build
  ffi.writeUInt16LE(fvParts[2] || 0, 14); // FileVersion Patch
  const pvParts = productVersion.split(".").map(Number);
  ffi.writeUInt16LE(pvParts[1] || 0, 16);
  ffi.writeUInt16LE(pvParts[0] || 0, 18);
  ffi.writeUInt16LE(pvParts[3] || 0, 20);
  ffi.writeUInt16LE(pvParts[2] || 0, 22);
  ffi.writeUInt32LE(0x3f, 24); // dwFileFlagsMask
  ffi.writeUInt32LE(0, 28); // dwFileFlags
  ffi.writeUInt32LE(0x00040004, 32); // dwFileOS = VOS_NT_WINDOWS32
  ffi.writeUInt32LE(1, 36); // dwFileType = VFT_APP
  ffi.writeUInt32LE(0, 40); // dwFileSubtype
  ffi.writeUInt32LE(0, 44); // dwFileDateMS
  ffi.writeUInt32LE(0, 48); // dwFileDateLS

  // Root VS_VERSIONINFO (key: "VS_VERSION_INFO\0")
  const rootKeyBuf = Buffer.from("VS_VERSION_INFO\0", "utf16le");
  const rootHeaderAndKey = 6 + rootKeyBuf.length;
  const ffiOffset = (rootHeaderAndKey + 3) & ~3;
  const childrenOffset = (ffiOffset + 52 + 3) & ~3;

  const totalLen = childrenOffset + sfiBuf.length + vfiBuf.length;
  const rootBuf = Buffer.alloc(totalLen);
  rootBuf.writeUInt16LE(totalLen, 0);
  rootBuf.writeUInt16LE(52, 2); // wValueLength = sizeof(VS_FIXEDFILEINFO)
  rootBuf.writeUInt16LE(0, 4); // wType = 0 (Binary for fixed info)
  rootKeyBuf.copy(rootBuf, 6);
  ffi.copy(rootBuf, ffiOffset);
  sfiBuf.copy(rootBuf, childrenOffset);
  vfiBuf.copy(rootBuf, childrenOffset + sfiBuf.length);

  return rootBuf;
}

const strings = {
  CompanyName: "Opinion Insights LLC",
  FileDescription: "Opinion Insights Browser",
  FileVersion: "152.0.7977.65",
  InternalName: "chrome_exe",
  LegalCopyright: "Copyright 2026 Opinion Insights LLC. All rights reserved.",
  OriginalFilename: "chrome.exe",
  ProductName: "Opinion Insights Browser",
  ProductVersion: "152.0.7977.65",
  CompanyShortName: "Opinion Insights",
  ProductShortName: "Opinion Insights Browser",
  LastChange: "fc4d67f1788019a27e32511137ceccbd2fafdaaa-refs/branch-heads/7977@{#1892}",
  OfficialBuild: "1"
};

const vBuf = createVersionInfo(strings);
console.log("Created version info buffer, total length:", vBuf.length);
fs.writeFileSync("scripts/test-version.bin", vBuf);
