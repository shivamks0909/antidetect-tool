import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

const structStart = 3870592;
const wLength = buf.readUInt16LE(structStart);
const versionBuf = Buffer.from(buf.subarray(structStart, structStart + wLength));

console.log("VS_VERSIONINFO raw length:", versionBuf.length);

// In VS_VERSIONINFO, we can replace:
// "ShardX\0" in UTF-16 with "Opinion Insights Browser\0" if we adjust wLength, or
// let's check the String structure:
function align4(n) {
  return (n + 3) & ~3;
}

// Let's dump all String entries with offsets
let offset = 0;
while (offset < versionBuf.length - 4) {
  const len = versionBuf.readUInt16LE(offset);
  const valLen = versionBuf.readUInt16LE(offset + 2);
  const type = versionBuf.readUInt16LE(offset + 4);
  
  if (len > 0 && len <= versionBuf.length - offset && (type === 0 || type === 1)) {
    // Read key
    let keyEnd = offset + 6;
    while (keyEnd < offset + len && versionBuf.readUInt16LE(keyEnd) !== 0) {
      keyEnd += 2;
    }
    const key = versionBuf.subarray(offset + 6, keyEnd).toString("utf16le");
    if (key.length > 2 && key.length < 50 && /^[A-Za-z0-9_]+$/.test(key)) {
      const valOffset = align4(keyEnd + 2);
      let val = "";
      if (valLen > 0 && valOffset < offset + len) {
        val = versionBuf.subarray(valOffset, valOffset + valLen * 2).toString("utf16le").replace(/\0.*$/, "");
      }
      console.log(`String at ${offset}: Key="${key}", ValLen=${valLen}, Val="${val}"`);
    }
  }
  offset += 2;
}
