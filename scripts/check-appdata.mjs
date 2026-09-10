import fs from "fs";
import path from "path";

const p = path.join(process.env.APPDATA, "opinion-insights-browser", "runtime");
if (fs.existsSync(p)) {
  console.log("Runtime exists at:", p);
  console.log("Contents:", fs.readdirSync(p));
  const eng = path.join(p, "Opinion-Insights-Engine");
  if (fs.existsSync(eng)) {
    console.log("Engine exists in AppData, files count:", fs.readdirSync(eng).length);
  }
  const icons = path.join(p, "profile-icons");
  if (fs.existsSync(icons)) {
    console.log("Cached profile-icons exist:", fs.readdirSync(icons).length, "icons:", fs.readdirSync(icons).slice(0, 10));
  }
} else {
  console.log("Runtime path does not exist:", p);
}
