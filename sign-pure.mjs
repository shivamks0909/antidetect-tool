// Minisign signing for Tauri updater (Blake2b-256 + Ed25519)
// Signs the .nsis.zip file (what Tauri updater actually downloads and verifies)
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign as edSign, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

process.chdir('c:/projects/antidetecr browser');
const require = createRequire(import.meta.url);
const { blake2b } = require('blakejs');
function blake2b256(data) { return Buffer.from(blake2b(data, { dkLen: 32 })); }

const keyFile = '.tauri/updater.key';
const pubFile = '.tauri/updater.key.pub';
const seedFile = '.tauri/updater.seed';

let privateKey;

if (existsSync(seedFile)) {
  const seedHex = readFileSync(seedFile, 'utf8').trim();
  const seed = Buffer.from(seedHex, 'hex');
  const pubHex = readFileSync(pubFile + '.raw', 'utf8').trim();
  const pubRaw = Buffer.from(pubHex, 'hex');
  const privJwk = { crv: 'Ed25519', d: seed.toString('base64url'), x: pubRaw.toString('base64url'), kty: 'OKP' };
  privateKey = createPrivateKey({ key: privJwk, format: 'jwk' });
  console.log('Reimported key from seed');
} else {
  const kp = generateKeyPairSync('ed25519');
  privateKey = kp.privateKey;
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
  writeFileSync(seedFile, privRaw.toString('hex'), 'utf8');
  writeFileSync(pubFile + '.raw', pubRaw.toString('hex'), 'utf8');
  const keyId = blake2b256(pubRaw).subarray(0, 8);
  console.log('Key ID:', Buffer.from(keyId).toString('hex'));
  const privBytes = Buffer.alloc(44); privBytes.set([0x01, 0x4d, 0x91, 0x72], 0);
  keyId.copy(privBytes, 4); privRaw.copy(privBytes, 12);
  writeFileSync(keyFile, `untrusted comment: primary key for signing updates\n${privBytes.toString('base64')}\n`, 'utf8');
  const pubBytes = Buffer.alloc(44); pubBytes.set([0x00, 0xed, 0x0f, 0x87], 0);
  keyId.copy(pubBytes, 4); pubRaw.copy(pubBytes, 12);
  writeFileSync(pubFile, `untrusted comment: primary key for signing updates\n${pubBytes.toString('base64')}\n`, 'utf8');
  console.log('Generated new key pair');
}

const pubContent = readFileSync(pubFile, 'utf8').trim();
const pubKeyStr = pubContent.split('\n')[1].trim();
console.log('Public key:', pubKeyStr);

// Find the NSIS .exe for the target version
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const targetVersion = process.argv[2] || conf.version;
const nsisDir = 'src-tauri/target/release/bundle/nsis';
const exeFiles = readdirSync(nsisDir).filter(f => f.endsWith('-setup.exe') && f.includes(targetVersion));
let exeName;
if (exeFiles.length === 0) {
  const allExe = readdirSync(nsisDir).filter(f => f.endsWith('-setup.exe'));
  if (allExe.length === 0) { console.error('No .exe found'); process.exit(1); }
  exeName = allExe[allExe.length - 1];
} else {
  exeName = exeFiles[0];
}
const exePath = join(nsisDir, exeName);
console.log(`Target version: ${targetVersion}, Found installer: ${exeName}`);

// Create .nsis.zip
const zipName = exeName.replace('.exe', '.nsis.zip');
const zipPath = join(nsisDir, zipName);
console.log(`Creating ${zipName}...`);
// Use PowerShell to create zip (cross-platform friendly on Windows)
execSync(`Compress-Archive -Path "${exePath}" -DestinationPath "${zipPath}" -Force`, { shell: 'powershell', stdio: 'pipe' });

// Sign the .nsis.zip (this is what Tauri updater downloads and verifies)
const zipData = readFileSync(zipPath);
console.log(`Signing ${zipData.length} bytes (${zipName})...`);

const keyContent = readFileSync(keyFile, 'utf8').trim();
const keyB64 = keyContent.split('\n')[1].trim();
const keyId = Buffer.from(keyB64, 'base64').subarray(4, 12);

const prehash = Buffer.concat([Buffer.from('Signature from ed25519 primary key\n'), keyId, zipData]);
const sigHash = blake2b256(prehash);
const signature = Buffer.from(edSign(null, sigHash, privateKey));

const sigBytes = Buffer.alloc(76);
sigBytes.writeUInt32BE(0x00000f43, 0);
keyId.copy(sigBytes, 4);
signature.copy(sigBytes, 12);

const sigStr = sigBytes.toString('base64');
writeFileSync(zipPath + '.sig', `untrusted comment: signature from tauri primary key\n${sigStr}\n`, 'utf8');
writeFileSync('.tauri/PUBLIC_KEY.txt', pubKeyStr, 'utf8');

console.log(`\n✅ DONE`);
console.log(`Signed: ${zipName}`);
console.log(`Sig file: ${zipPath}.sig`);
console.log(`\n⚠️  PUBLIC KEY for tauri.conf.json: ${pubKeyStr}`);
console.log(`\n⚠️  SIGNATURE for version.json: ${sigStr}`);
console.log(`\n⚠️  Upload ${zipName} to R2 at: v2.2.0/${zipName}`);
