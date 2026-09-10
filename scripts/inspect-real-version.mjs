import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

const target = Buffer.from("VS_VERSION_INFO\0", "utf16le");
let pos = 3654144;
const realPos = buf.indexOf(target, pos);
console.log("Real VS_VERSION_INFO pos in .rsrc:", realPos);

if (realPos !== -1) {
  const structStart = realPos - 6;
  const wLength = buf.readUInt16LE(structStart);
  const wValueLength = buf.readUInt16LE(structStart + 2);
  const wType = buf.readUInt16LE(structStart + 4);
  console.log({ structStart, wLength, wValueLength, wType });

  const versionSlice = buf.subarray(structStart, structStart + wLength);
  console.log("Version struct size:", versionSlice.length);
  const u16 = versionSlice.toString("utf16le");
  console.log("Strings in version info:\n", u16.replace(/[^\x20-\x7E]+/g, " | "));
}
