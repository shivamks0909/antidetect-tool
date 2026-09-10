import fs from "fs";

const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

// Search for "VS_VERSION_INFO" in UTF16-LE
const target = Buffer.from("VS_VERSION_INFO\0", "utf16le");
const pos = buf.indexOf(target);
console.log("VS_VERSION_INFO pos:", pos);

if (pos !== -1) {
  // Structure starts 6 bytes before "VS_VERSION_INFO":
  // wLength: uint16
  // wValueLength: uint16
  // wType: uint16
  const structStart = pos - 6;
  const wLength = buf.readUInt16LE(structStart);
  const wValueLength = buf.readUInt16LE(structStart + 2);
  const wType = buf.readUInt16LE(structStart + 4);
  console.log({ structStart, wLength, wValueLength, wType });

  const versionSlice = buf.subarray(structStart, structStart + wLength);
  console.log("Version struct size:", versionSlice.length);
  // Find strings in this block
  const u16 = versionSlice.toString("utf16le");
  console.log("Version strings:\n", u16.replace(/[^\x20-\x7E]+/g, " | "));
}
