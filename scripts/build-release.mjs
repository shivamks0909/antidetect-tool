import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const keyPath = resolve('.tauri/updater.key');
const keyContent = readFileSync(keyPath, 'utf8').trim();

const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyContent,
  TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'OpinionInsightsSecureUpdateKey2026',
};

console.log('[BUILD] Signing private key loaded successfully (' + keyContent.length + ' chars).');
console.log('[BUILD] Executing npx tauri build...');

try {
  execSync('npx tauri build', { stdio: 'inherit', env });
  console.log('[BUILD] Release build completed successfully!');
} catch (err) {
  console.error('[BUILD] Build failed:', err.message);
  process.exit(1);
}
