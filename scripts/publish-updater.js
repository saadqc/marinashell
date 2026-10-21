'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('../main/services/updater/config');
const exec = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const targets = { 'darwin-arm64': 'app-tar-gz', 'win32-x64': 'nsis', 'linux-x64': 'appimage' };

function compareVersions(a, b) {
  const parse = value => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Expected a stable numeric release version.');
    const parts = value.split('.').map(Number);
    if (parts.some(n => !Number.isSafeInteger(n))) throw new Error('Invalid release version.');
    return parts;
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error('Release inputs must be ordinary files.');
  }
  return files.sort();
}

function signManifest(manifest, privateKey, publicKey = config.publicKey) {
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const signature = crypto.sign(null, bytes, privateKey);
  if (!crypto.verify(null, bytes, publicKey, signature)) throw new Error('Updater private key does not match the app public key.');
  return { bytes, signature: Buffer.from(signature.toString('base64') + '\n') };
}

function verifyFeed(bytes, signature, publicKey = config.publicKey) {
  if (!crypto.verify(null, bytes, publicKey, Buffer.from(signature.toString().trim(), 'base64')))
    throw new Error('Existing feed signature is invalid.');
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1) throw new Error('Unknown updater feed schema.');
  compareVersions(manifest.version, manifest.version);
  return manifest;
}

function encodeEnvelope(signed) {
  return Buffer.from(JSON.stringify({ schema: 1, payload: signed.bytes.toString('base64'), signature: signed.signature.toString().trim() }) + '\n');
}

function verifyEnvelope(bytes, publicKey = config.publicKey) {
  if (bytes.length > 512 * 1024) throw new Error('Update envelope is too large.');
  const envelope = JSON.parse(bytes);
  if (envelope.schema !== 1 || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload) || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error('Invalid update envelope.');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (payload.toString('base64') !== envelope.payload || payload.length > 256 * 1024) throw new Error('Invalid envelope payload.');
  return { manifest: verifyFeed(payload, Buffer.from(envelope.signature), publicKey), bytes: payload, signature: Buffer.from(envelope.signature + '\n') };
}

async function collectRelease(directory, version, notes) {
  compareVersions(version, version);
  const files = await listFiles(directory), platforms = {}, assets = new Map();
  const add = async (file, name = path.basename(file)) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Unsafe release asset filename.');
    const bytes = await fs.readFile(file), record = { file, name, size: bytes.length, sha256: hash(bytes) };
    const previous = assets.get(name);
    if (previous && previous.sha256 !== record.sha256) throw new Error('Conflicting release assets.');
    assets.set(name, record);
    return record;
  };
  for (const file of files.filter(file => /^updater-(darwin-arm64|win32-x64|linux-x64)\.json$/.test(path.basename(file)))) {
    const meta = JSON.parse(await fs.readFile(file, 'utf8'));
    if (meta.version !== version || !Object.hasOwn(targets, meta.platform) || platforms[meta.platform]) throw new Error('Unexpected or duplicate updater target.');
    const artifact = meta.artifact;
    if (!artifact || artifact.kind !== targets[meta.platform] || !/^[A-Za-z0-9_.-]+$/.test(artifact.name)) throw new Error('Invalid updater artifact.');
    const record = await add(path.join(path.dirname(file), artifact.name));
    if (record.size !== artifact.size || record.sha256 !== artifact.sha256) throw new Error('Updater artifact differs from validated metadata.');
    platforms[meta.platform] = {
      url: `https://github.com/${config.repository}/releases/download/v${version}/${record.name}`,
      size: record.size, sha256: record.sha256, kind: artifact.kind
    };
  }
  if (Object.keys(platforms).length !== 3) throw new Error('All three platform updater artifacts are required.');
  const installerNames = [
    `MarinaShell-${version}-arm64.dmg`, `MarinaShell-${version}-win.zip`,
    `MarinaShell-${version}.AppImage`, `marinashell_${version}_amd64.deb`,
    `MarinaShell.Setup.${version}.exe`
  ];
  for (const name of installerNames) {
    const found = files.filter(file => path.basename(file).replace(/ /g, '.') === name);
    if (!found.length) throw new Error('Missing release installer: ' + name);
    for (const file of found) await add(file, name);
  }
  return {
    manifest: { schema: 1, version, notes, pub_date: new Date().toISOString(), platforms },
    assets
  };
}

async function publish({ directory, version, privateKey, notesFile, run = exec, publicKey = config.publicKey }) {
  if (!privateKey) throw new Error('UPDATER_SIGNING_PRIVATE_KEY is required.');
  const notes = await fs.readFile(notesFile, 'utf8');
  const { manifest, assets } = await collectRelease(directory, version, notes);
  const signed = signManifest(manifest, privateKey, publicKey);
  const gh = async args => (await run('gh', [...args, '--repo', config.repository], { maxBuffer: 8 * 1024 * 1024 })).stdout;
  const inspect = async tag => {
    try { return JSON.parse(await gh(['release', 'view', tag, '--json', 'isDraft,isPrerelease,assets,url'])); }
    catch (error) { if (/release not found/i.test(String(error.stderr))) return null; throw error; }
  };
  const feed = await inspect('updater');
  const tag = `v${version}`;
  let release = await inspect(tag);
  const scratch = await fs.mkdtemp(path.join(directory, '.publish-'));
  try {
    if (release && !release.isDraft) {
      const existingDir = path.join(scratch, 'existing');
      await fs.mkdir(existingDir);
      await gh(['release', 'download', tag, '--pattern', 'latest.json', '--dir', existingDir]);
      const bytes = await fs.readFile(path.join(existingDir, 'latest.json'));
      const decoded = verifyEnvelope(bytes, publicKey), existing = decoded.manifest;
      if (existing.version !== version || JSON.stringify(existing.platforms) !== JSON.stringify(manifest.platforms)) throw new Error('Existing release has different updater artifacts.');
      signed.bytes = decoded.bytes;
      signed.signature = decoded.signature;
    }
    if (feed?.assets.length) {
      if (feed.assets.length !== 1 || feed.assets[0].name !== 'latest.json') throw new Error('Unexpected updater channel assets.');
      await gh(['release', 'download', 'updater', '--pattern', 'latest.json', '--dir', scratch]);
      const decoded = verifyEnvelope(await fs.readFile(path.join(scratch, 'latest.json')), publicKey), previous = decoded.manifest;
      const comparison = compareVersions(version, previous.version);
      if (comparison < 0) throw new Error('Refusing to roll the updater feed backward.');
      if (comparison === 0) {
        if (JSON.stringify(previous.platforms) !== JSON.stringify(manifest.platforms)) throw new Error('Published version has different updater artifacts.');
        // Reuse the exact signed feed bytes on an idempotent publication retry.
        signed.bytes = decoded.bytes;
        signed.signature = decoded.signature;
      }
    } else if (feed && !feed.isDraft) throw new Error('Published update channel has no manifest.');
    const publishDir = path.join(scratch, 'assets');
    await fs.mkdir(publishDir);
    for (const record of assets.values()) await fs.copyFile(record.file, path.join(publishDir, record.name));
    await fs.writeFile(path.join(publishDir, 'latest.json'), encodeEnvelope(signed));
    for (const name of ['latest.json']) {
      const file = path.join(publishDir, name), bytes = await fs.readFile(file);
      assets.set(name, { file, name, size: bytes.length, sha256: hash(bytes) });
    }
    const checksum = Buffer.from([...assets.values()].map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
    await fs.writeFile(path.join(publishDir, 'SHA256SUMS.txt'), checksum);
    assets.set('SHA256SUMS.txt', { name: 'SHA256SUMS.txt', size: checksum.length, sha256: hash(checksum) });
    if (!release) {
      await gh(['release', 'create', tag, '--verify-tag', '--draft', '--title', `MarinaShell ${tag}`, '--notes-file', notesFile]);
      release = await inspect(tag);
    }
    if (release.isDraft) await gh(['release', 'upload', tag, ...[...assets.keys()].map(name => path.join(publishDir, name)), '--clobber']);
    release = await inspect(tag);
    if (release.assets.length !== assets.size) throw new Error('Unexpected release asset count.');
    for (const asset of release.assets) {
      const expected = assets.get(asset.name);
      if (!expected || expected.size !== asset.size || asset.digest !== `sha256:${expected.sha256}`) throw new Error('Uploaded release asset verification failed.');
    }
    if (release.isDraft) await gh(['release', 'edit', tag, '--draft=false']);
    release = await inspect(tag);
    if (release.isDraft) throw new Error('Versioned release was not published.');
    if (!feed) await gh(['release', 'create', 'updater', '--target', process.env.GITHUB_SHA, '--draft', '--prerelease', '--latest=false', '--title', 'Automatic update feed', '--notes', 'Machine-readable signed update feed. Download the application from a versioned release.']);
    await gh(['release', 'upload', 'updater', path.join(publishDir, 'latest.json'), '--clobber']);
    const publishedFeed = await inspect('updater');
    for (const name of ['latest.json']) {
      const asset = publishedFeed.assets.find(a => a.name === name), expected = assets.get(name);
      if (!asset || asset.size !== expected.size || asset.digest !== `sha256:${expected.sha256}`) throw new Error('Published updater feed verification failed.');
    }
    if (publishedFeed.isDraft) await gh(['release', 'edit', 'updater', '--draft=false', '--prerelease', '--latest=false']);
    if ((await inspect('updater')).isDraft) throw new Error('Update channel was not published.');
    return { version, url: release.url, assets: [...assets.keys()] };
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

module.exports = { compareVersions, signManifest, verifyFeed, encodeEnvelope, verifyEnvelope, collectRelease, publish };
if (require.main === module) {
  const version = require('../package.json').version;
  if (process.env.GITHUB_REPOSITORY !== config.repository || process.env.RELEASE_TAG !== `v${version}`) throw new Error('Publication requires the matching repository and version tag.');
  publish({ directory: path.resolve(process.argv[2] || 'release-bundles'), version, privateKey: process.env.UPDATER_SIGNING_PRIVATE_KEY, notesFile: path.resolve(__dirname, '../RELEASE_NOTES.md') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
