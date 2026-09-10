import { cpSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, join } from 'path';

const releaseExe = resolve('src-tauri/target/release/opinion-insights-launcher.exe');
const resourcesDir = resolve('src-tauri/resources');
const portableDir = resolve('release-portable');

console.log('[PORTABLE] Packaging portable release distribution...');

if (!existsSync(releaseExe)) {
  console.error('[ERROR] Release EXE not found at:', releaseExe);
  process.exit(1);
}

mkdirSync(portableDir, { recursive: true });

copyFileSync(releaseExe, join(portableDir, 'Opinion Insights Browser.exe'));
console.log('✓ Copied executable: release-portable/Opinion Insights Browser.exe');

if (existsSync(resourcesDir)) {
  cpSync(resourcesDir, join(portableDir, 'resources'), { recursive: true });
  console.log('✓ Copied bundled resources: release-portable/resources');
}

console.log('[SUCCESS] Portable release created at: ' + portableDir);
