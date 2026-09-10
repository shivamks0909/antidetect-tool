import fs from "fs";
import { parseIco } from "./parse-ico.mjs";

const icoBuf = fs.readFileSync("src-tauri/icons/icon.ico");
const parsed = parseIco(icoBuf);

fs.writeFileSync("scripts/grp_mainframe.bin", parsed.grpBuf);
for (const ic of parsed.icons) {
  fs.writeFileSync(`scripts/icon_${ic.id}.bin`, ic.data);
}

fs.writeFileSync("scripts/ico_meta.json", JSON.stringify({
  iconCount: parsed.icons.length
}, null, 2));

console.log("Successfully exported ico resources to scripts/!");
