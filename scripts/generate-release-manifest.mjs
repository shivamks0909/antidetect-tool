import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = tauriConf.version || '2.0.2';
const sigPath = resolve(`src-tauri/target/release/bundle/nsis/Opinion Insights Browser_${version}_x64-setup.exe.sig`);

if (!existsSync(sigPath)) {
  console.error('[ERROR] Signature file not found at:', sigPath);
  process.exit(1);
}

const signature = readFileSync(sigPath, 'utf8').trim();

const manifest = {
  version,
  notes: `Opinion Insights Browser v${version} Release - High-Performance Enterprise Multi-Profile Platform with Complete Tenant Isolation, High-Fidelity Antidetect Engine, Batch XLSX/CSV Provisioning, and Non-Destructive Auto-Updates.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/opinion-insights/antidetect-browser/releases/download/v${version}/Opinion.Insights.Browser_${version}_x64-setup.exe`,
    },
  },
};

const outPathRelease = resolve('src-tauri/target/release/bundle/nsis/latest.json');
const outPathRoot = resolve('latest.json');

writeFileSync(outPathRelease, JSON.stringify(manifest, null, 2), 'utf8');
writeFileSync(outPathRoot, JSON.stringify(manifest, null, 2), 'utf8');

console.log('[SUCCESS] Generated updater manifest:');
console.log(' - ' + outPathRelease);
console.log(' - ' + outPathRoot);
console.log(JSON.stringify(manifest, null, 2));
