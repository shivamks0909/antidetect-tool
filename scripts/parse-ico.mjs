import fs from "fs";

/**
 * Parses a .ico buffer into { groupIconDir: Buffer, icons: Array<{ id: number, data: Buffer }> }
 */
export function parseIco(icoBuf) {
  const idReserved = icoBuf.readUInt16LE(0);
  const idType = icoBuf.readUInt16LE(2);
  const count = icoBuf.readUInt16LE(4);

  if (idReserved !== 0 || idType !== 1) {
    throw new Error("Invalid .ico file");
  }

  // Header is 6 bytes. Each GRPICONDIRENTRY is 14 bytes (instead of 16 in .ico).
  const grpHeaderSize = 6 + count * 14;
  const grpBuf = Buffer.alloc(grpHeaderSize);

  grpBuf.writeUInt16LE(idReserved, 0);
  grpBuf.writeUInt16LE(idType, 2);
  grpBuf.writeUInt16LE(count, 4);

  const icons = [];

  let icoOffset = 6;
  let grpOffset = 6;

  for (let i = 0; i < count; i++) {
    const bWidth = icoBuf.readUInt8(icoOffset);
    const bHeight = icoBuf.readUInt8(icoOffset + 1);
    const bColorCount = icoBuf.readUInt8(icoOffset + 2);
    const bReserved = icoBuf.readUInt8(icoOffset + 3);
    const wPlanes = icoBuf.readUInt16LE(icoOffset + 4);
    const wBitCount = icoBuf.readUInt16LE(icoOffset + 6);
    const dwBytesInRes = icoBuf.readUInt32LE(icoOffset + 8);
    const dwImageOffset = icoBuf.readUInt32LE(icoOffset + 12);

    const iconId = i + 1;

    // Write to grpBuf
    grpBuf.writeUInt8(bWidth, grpOffset);
    grpBuf.writeUInt8(bHeight, grpOffset + 1);
    grpBuf.writeUInt8(bColorCount, grpOffset + 2);
    grpBuf.writeUInt8(bReserved, grpOffset + 3);
    grpBuf.writeUInt16LE(wPlanes, grpOffset + 4);
    grpBuf.writeUInt16LE(wBitCount, grpOffset + 6);
    grpBuf.writeUInt32LE(dwBytesInRes, grpOffset + 8);
    grpBuf.writeUInt16LE(iconId, grpOffset + 12);

    const iconData = Buffer.from(icoBuf.subarray(dwImageOffset, dwImageOffset + dwBytesInRes));
    icons.push({ id: iconId, data: iconData });

    icoOffset += 16;
    grpOffset += 14;
  }

  return { grpBuf, icons };
}

const ico = fs.readFileSync("src-tauri/icons/icon.ico");
const parsed = parseIco(ico);
console.log(`Parsed icon.ico: ${parsed.icons.length} sub-icons. GRPICONDIR size: ${parsed.grpBuf.length}`);
for (const ic of parsed.icons) {
  console.log(`Icon ID ${ic.id}: size ${ic.data.length} bytes`);
}
