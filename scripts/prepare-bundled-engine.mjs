import { existsSync, cpSync, statSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const appData = process.env.APPDATA || 'C:\\Users\\iamth\\AppData\\Roaming';
const srcEngine = join(appData, 'opinion-insights-browser', 'runtime', 'ShardX-Windows');
const targetEngine = resolve('src-tauri/resources/Opinion-Insights-Engine');

console.log('[BUNDLE-ENGINE] Source:', srcEngine);
console.log('[BUNDLE-ENGINE] Target:', targetEngine);

if (!existsSync(srcEngine)) {
  console.error('[ERROR] Source engine does not exist at:', srcEngine);
  process.exit(1);
}

if (!existsSync(join(srcEngine, 'chrome.exe'))) {
  console.error('[ERROR] chrome.exe not found in source:', srcEngine);
  process.exit(1);
}

console.log('[BUNDLE-ENGINE] Copying engine files to resources/Opinion-Insights-Engine...');
cpSync(srcEngine, targetEngine, { recursive: true, force: true });

const chromeExe = join(targetEngine, 'chrome.exe');
if (existsSync(chromeExe)) {
  const size = statSync(chromeExe).size;
  console.log(`[SUCCESS] chrome.exe successfully copied (${(size / 1024 / 1024).toFixed(2)} MB)`);
  const files = readdirSync(targetEngine);
  console.log(`[SUCCESS] Copied ${files.length} items to ${targetEngine}`);
} else {
  console.error('[ERROR] chrome.exe missing in target after copy');
  process.exit(1);
}
