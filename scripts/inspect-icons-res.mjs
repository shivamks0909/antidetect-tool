import fs from "fs";

// Inspect icon resources in chrome.exe
const exePath = "src-tauri/resources/Opinion-Insights-Engine/chrome.exe";
const buf = fs.readFileSync(exePath);

// We can also check with PowerShell EnumResourceNames
