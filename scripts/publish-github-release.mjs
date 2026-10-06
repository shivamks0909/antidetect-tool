import fs from 'fs';
import path from 'path';
import https from 'https';

const REPO = 'shivamks0909/antidetect-tool';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const VERSION = '2.4.0';
const TAG = `v${VERSION}`;

const bundleDir = path.resolve('src-tauri/target/release/bundle/nsis');
const exeSrc = path.join(bundleDir, `Opinion Insights Browser_${VERSION}_x64-setup.exe`);
const zipSrc = path.join(bundleDir, `Opinion Insights Browser_${VERSION}_x64-setup.nsis.zip`);
const sigSrc = path.join(bundleDir, `Opinion Insights Browser_${VERSION}_x64-setup.nsis.zip.sig`);

const exeTargetName = `Opinion.Insights.Browser_${VERSION}_x64-setup.exe`;
const zipTargetName = `Opinion.Insights.Browser_${VERSION}_x64-setup.nsis.zip`;
const sigTargetName = `Opinion.Insights.Browser_${VERSION}_x64-setup.nsis.zip.sig`;

if (!fs.existsSync(exeSrc) || !fs.existsSync(zipSrc) || !fs.existsSync(sigSrc)) {
  console.error('Artifacts missing in bundle directory!');
  process.exit(1);
}

function requestJson(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function uploadAsset(uploadUrl, filePath, assetName, contentType) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const urlObj = new URL(uploadUrl.replace(/\{.*?\}$/, `?name=${encodeURIComponent(assetName)}`));
    console.log(`Uploading ${assetName} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Node-Uploader',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': contentType,
        'Content-Length': stat.size,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Upload status for ${assetName}:`, res.statusCode);
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
    });
    req.on('error', reject);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(req);
  });
}

async function main() {
  console.log(`[1] Creating GitHub Release ${TAG}...`);
  let releaseRes = await requestJson({
    hostname: 'api.github.com',
    path: `/repos/${REPO}/releases`,
    method: 'POST',
    headers: {
      'User-Agent': 'Node-Uploader',
      'Authorization': `token ${TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
    },
  }, {
    tag_name: TAG,
    name: TAG,
    body: `Opinion Insights Browser ${TAG} — Offline self-contained release with bundled Chromium engine. Authentication gate removed.`,
    draft: false,
    prerelease: false,
  });

  let release = releaseRes.data;
  if (releaseRes.status !== 201) {
    console.log('Release might already exist, fetching by tag...');
    const existing = await requestJson({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/tags/${TAG}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Node-Uploader',
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    release = existing.data;
  }

  console.log(`Release URL: ${release.html_url}, upload_url: ${release.upload_url}`);

  // Delete existing assets if they exist
  if (Array.isArray(release.assets)) {
    for (const a of release.assets) {
      if ([exeTargetName, zipTargetName, sigTargetName].includes(a.name)) {
        console.log(`Deleting existing asset ${a.name} (ID: ${a.id})...`);
        await requestJson({
          hostname: 'api.github.com',
          path: `/repos/${REPO}/releases/assets/${a.id}`,
          method: 'DELETE',
          headers: {
            'User-Agent': 'Node-Uploader',
            'Authorization': `token ${TOKEN}`,
          },
        });
      }
    }
  }

  console.log('\n[2] Uploading release assets...');
  await uploadAsset(release.upload_url, sigSrc, sigTargetName, 'text/plain');
  await uploadAsset(release.upload_url, exeSrc, exeTargetName, 'application/vnd.microsoft.portable-executable');
  await uploadAsset(release.upload_url, zipSrc, zipTargetName, 'application/zip');

  console.log('\n[3] Updating update-server/version.json...');
  const sigRaw = fs.readFileSync(sigSrc, 'utf8').trim();
  const sigLine = sigRaw.split('\n').filter(l => !l.startsWith('untrusted comment'))[0].trim();
  const downloadUrl = `https://github.com/${REPO}/releases/download/${TAG}/${zipTargetName}`;

  const manifest = {
    version: VERSION,
    notes: `Opinion Insights Browser ${TAG} — Offline self-contained release with bundled Chromium runtime. Authentication gate removed.`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        url: downloadUrl,
        signature: sigLine,
      },
    },
  };

  fs.writeFileSync('update-server/version.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Manifest updated:\n', JSON.stringify(manifest, null, 2));

  console.log('\n✅ All GitHub assets uploaded and manifest updated successfully!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
