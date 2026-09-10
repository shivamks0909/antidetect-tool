#!/usr/bin/env node

/**
 * Developer Helper: Generate and inspect Ed25519 signing keys for Tauri auto-updates.
 *
 * Usage:
 *   node scripts/generate-update-keys.mjs
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const keyPath = resolve('.tauri/updater.key');
const pubKeyPath = resolve('.tauri/updater.key.pub');

console.log('==================================================================');
console.log('       OPINION INSIGHTS BROWSER - UPDATE SIGNER KEY STATUS        ');
console.log('==================================================================\n');

if (existsSync(pubKeyPath)) {
  const pubKey = readFileSync(pubKeyPath, 'utf8').trim();
  console.log('✓ Public Key is configured:');
  console.log(`  ${pubKey}\n`);
  console.log('Embedded in: src-tauri/tauri.conf.json -> plugins.updater.pubkey\n');
} else {
  console.warn('⚠️ Public key file not found at .tauri/updater.key.pub');
  console.log('Run: npx tauri signer generate -w .tauri/updater.key');
}

if (existsSync(keyPath)) {
  console.log('✓ Private Key file exists at .tauri/updater.key (NEVER commit this to git!).\n');
  console.log('To configure GitHub Actions CI/CD auto-updates:');
  console.log('1. Go to your GitHub Repository -> Settings -> Secrets and variables -> Actions');
  console.log('2. Add secret: TAURI_SIGNING_PRIVATE_KEY');
  console.log('   Value: Content of .tauri/updater.key');
  console.log('3. Add secret: TAURI_SIGNING_PRIVATE_KEY_PASSWORD');
  console.log('   Value: OpinionInsightsSecureUpdateKey2026');
  console.log('\nWhen you push a git tag (e.g. git tag v2.0.2 && git push --tags),');
  console.log('GitHub Actions will automatically build, sign, and release the update!');
} else {
  console.warn('⚠️ Private key file not found at .tauri/updater.key');
}

console.log('\n==================================================================');
