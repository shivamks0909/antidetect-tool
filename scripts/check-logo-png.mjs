import fs from "fs";

// Read png chunks
const buf = fs.readFileSync("public/logo.png");
console.log("Header:", buf.subarray(0, 8));
let offset = 8;
while (offset < buf.length) {
  const length = buf.readUInt32BE(offset);
  const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
  console.log(`Chunk: ${type}, length: ${length}`);
  offset += 8 + length + 4;
}
