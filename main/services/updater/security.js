'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const MAX_ARTIFACT = 1024 * 1024 * 1024;
function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid update version.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Invalid update version.');
  return parts;
}
function newer(candidate, current) {
  const left = versionParts(candidate), right = versionParts(current);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i]; }
  return false;
}
function releaseURL(value, repository) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(`/${repository}/releases/download/`)) throw new Error('Update URL is not an official release.');
  return url;
}
function redirectURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) throw new Error('Untrusted update redirect.');
  return url;
}
function decodeEnvelope(bytes) {
  if (bytes.length > 512 * 1024) throw new Error('Update metadata exceeds its limit.');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (envelope.schema !== 1 || typeof envelope.payload !== 'string' || envelope.payload.length > 350000 || typeof envelope.signature !== 'string') throw new Error('Invalid signed update envelope.');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (payload.toString('base64') !== envelope.payload) throw new Error('Invalid update payload encoding.');
  return { bytes: payload, signature: Buffer.from(envelope.signature, 'utf8') };
}
function verifyManifest(bytes, signature, publicKey, repository) {
  if (!publicKey || bytes.length > 256 * 1024 || signature.length > 4096) throw new Error('Invalid update metadata.');
  const text = signature.toString('utf8').trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(text)) throw new Error('Invalid update signature.');
  if (!crypto.verify(null, bytes, publicKey, Buffer.from(text, 'base64'))) throw new Error('Update signature verification failed.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  versionParts(manifest.version);
  if (manifest.schema !== 1 || !manifest.platforms || typeof manifest.platforms !== 'object') throw new Error('Unsupported update metadata.');
  if (manifest.notes !== undefined && (typeof manifest.notes !== 'string' || manifest.notes.length > 20000)) throw new Error('Invalid release notes.');
  for (const [target, artifact] of Object.entries(manifest.platforms)) {
    if (!['darwin-arm64', 'win32-x64', 'linux-x64'].includes(target) || !artifact || !['app-tar-gz', 'nsis', 'appimage'].includes(artifact.kind)) throw new Error('Unsupported update platform.');
    releaseURL(artifact.url, repository);
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Invalid update artifact.');
    if ({ 'darwin-arm64': 'app-tar-gz', 'win32-x64': 'nsis', 'linux-x64': 'appimage' }[target] !== artifact.kind) throw new Error('Incorrect update package type.');
  }
  return manifest;
}
async function fetchToFile(url, file, { limit, expectedSize, onProgress = () => {}, timeout = 10 * 60 * 1000 } = {}) {
  const handle = await fs.open(file, 'wx', 0o600);
  let received = 0, active;
  const hash = crypto.createHash('sha256');
  const timer = setTimeout(() => active?.destroy(new Error('Update download timed out.')), timeout);
  timer.unref();
  try {
    let next = redirectURL(url);
    for (let count = 0; ; count++) {
      const response = await new Promise((resolve, reject) => {
        active = https.get(next, { headers: { 'User-Agent': 'MarinaShell-Updater', Accept: 'application/octet-stream' } }, resolve);
        active.setTimeout(30000, () => active.destroy(new Error('Update server timed out.')));
        active.once('error', reject);
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (count >= 5 || !response.headers.location) throw new Error('Too many update redirects.');
        next = redirectURL(new URL(response.headers.location, next).href); continue;
      }
      if (response.statusCode !== 200) { response.resume(); throw new Error(`Update server returned HTTP ${response.statusCode}.`); }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && (declared > limit || (expectedSize && declared !== expectedSize))) { response.destroy(); throw new Error('Update size does not match release metadata.'); }
      for await (const chunk of response) {
        received += chunk.length;
        if (received > limit) { response.destroy(); throw new Error('Update exceeds the permitted size.'); }
        hash.update(chunk); await handle.writeFile(chunk); onProgress(received, expectedSize || declared || 0);
      }
      break;
    }
    if (expectedSize && received !== expectedSize) throw new Error('Update download was incomplete.');
    await handle.sync();
    return { size: received, sha256: hash.digest('hex') };
  } catch (error) { await fs.unlink(file).catch(() => {}); throw error; }
  finally { clearTimeout(timer); active?.destroy(); await handle.close(); }
}
async function hashFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT) throw new Error('Invalid cached update.');
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return { size: stat.size, sha256: hash.digest('hex') };
}
async function verifyArtifact(file, artifact) {
  const actual = await hashFile(file);
  if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) throw new Error('Update checksum verification failed.');
}
function archiveEntry(entry, appName) {
  const item = entry.path.replace(/\/$/, '');
  if (!item || item.includes('\\') || item.includes('\0') || path.posix.isAbsolute(item) || item.split('/').includes('..') || !(item === appName || item.startsWith(`${appName}/`))) throw new Error('Unsafe update archive path.');
  if (!['Directory', 'File', 'SymbolicLink'].includes(entry.type)) throw new Error('Unsupported update archive entry.');
  if (entry.type === 'SymbolicLink') {
    const link = entry.linkpath;
    const destination = path.posix.normalize(path.posix.join(path.posix.dirname(item), link));
    if (!link || link.includes('\\') || link.includes('\0') || path.posix.isAbsolute(link) || !(destination === appName || destination.startsWith(`${appName}/`))) throw new Error('Unsafe update archive link.');
  }
}
module.exports = { MAX_ARTIFACT, newer, versionParts, releaseURL, redirectURL, verifyManifest, decodeEnvelope, fetchToFile, hashFile, verifyArtifact, archiveEntry };
