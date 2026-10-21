'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { compareVersions, signManifest, verifyFeed, encodeEnvelope, verifyEnvelope, collectRelease, publish } = require('./publish-updater');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

test('signed updater manifest rejects tampering and a mismatched signing key', () => {
  const keys = crypto.generateKeyPairSync('ed25519'), other = crypto.generateKeyPairSync('ed25519');
  const manifest = { schema: 1, version: '0.2.25', platforms: {} };
  const result = signManifest(manifest, keys.privateKey, keys.publicKey);
  assert.deepEqual(verifyFeed(result.bytes, result.signature, keys.publicKey), manifest);
  assert.throws(() => verifyFeed(Buffer.from(result.bytes.toString().replace('0.2.25', '9.0.0')), result.signature, keys.publicKey), /invalid/);
  assert.throws(() => signManifest(manifest, keys.privateKey, other.publicKey), /does not match/);
  assert.throws(() => verifyFeed(result.bytes, result.signature, other.publicKey), /invalid/);
  const envelope = encodeEnvelope(result);
  assert.deepEqual(verifyEnvelope(envelope, keys.publicKey).manifest, manifest);
  const tampered = JSON.parse(envelope); tampered.payload = Buffer.from('{"version":"9.0.0"}').toString('base64');
  assert.throws(() => verifyEnvelope(Buffer.from(JSON.stringify(tampered)), keys.publicKey), /invalid/);
  assert.throws(() => verifyEnvelope(Buffer.from('{"schema":1}'), keys.publicKey), /Invalid/);
});

test('feed version ordering is numeric and rejects ambiguous or unsafe versions', () => {
  assert.equal(compareVersions('0.2.25', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.25', '0.2.25'), 0);
  assert.equal(compareVersions('0.2.25', '0.3.0'), -1);
  for (const invalid of ['v0.2.25', '0.2', '0.2.25-next', '1.0.9007199254740992']) assert.throws(() => compareVersions(invalid, '0.2.25'));
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marina-update-publish-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const entries = [
    ['darwin-arm64', 'MarinaShell_0.2.25_macos_arm64.app.tar.gz', 'app-tar-gz'],
    ['win32-x64', 'MarinaShell.Setup.0.2.25.exe', 'nsis'],
    ['linux-x64', 'MarinaShell-0.2.25.AppImage', 'appimage']
  ];
  for (const [platform, name, kind] of entries) {
    const folder = path.join(dir, platform); await fs.mkdir(folder);
    const bytes = Buffer.from(platform); await fs.writeFile(path.join(folder, name), bytes);
    await fs.writeFile(path.join(folder, `updater-${platform}.json`), JSON.stringify({ version: '0.2.25', platform, artifact: { name, size: bytes.length, sha256: digest(bytes), kind } }));
  }
  for (const name of ['MarinaShell-0.2.25-arm64.dmg', 'MarinaShell-0.2.25-win.zip', 'marinashell_0.2.25_amd64.deb']) await fs.writeFile(path.join(dir, name), name);
  return dir;
}

test('publication requires every platform, keeps DMG installer, and creates immutable artifact URLs', async t => {
  const dir = await fixture(t), result = await collectRelease(dir, '0.2.25', 'Release notes');
  assert.equal(result.assets.size, 6);
  assert.equal(result.manifest.notes, 'Release notes');
  for (const target of Object.values(result.manifest.platforms)) assert.match(target.url, /^https:\/\/github.com\/saadqc\/marinashell\/releases\/download\/v0\.2\.25\//);
  assert.ok(result.assets.has('MarinaShell-0.2.25-arm64.dmg'));
  await fs.rm(path.join(dir, 'linux-x64/updater-linux-x64.json'));
  await assert.rejects(collectRelease(dir, '0.2.25', ''), /All three/);
});

test('publication rejects artifacts changed after validation', async t => {
  const dir = await fixture(t);
  await fs.appendFile(path.join(dir, 'win32-x64/MarinaShell.Setup.0.2.25.exe'), 'tampered');
  await assert.rejects(collectRelease(dir, '0.2.25', ''), /differs/);
});

test('publication rejects metadata traversal and conflicting installer duplicates', async t => {
  const dir = await fixture(t), metaPath = path.join(dir, 'linux-x64/updater-linux-x64.json');
  const meta = JSON.parse(await fs.readFile(metaPath));
  meta.artifact.name = '../MarinaShell-0.2.25-arm64.dmg';
  await fs.writeFile(metaPath, JSON.stringify(meta));
  await assert.rejects(collectRelease(dir, '0.2.25', ''), /Invalid updater/);
  const second = await fixture(t);
  await fs.writeFile(path.join(second, 'darwin-arm64/MarinaShell-0.2.25-arm64.dmg'), 'different');
  await assert.rejects(collectRelease(second, '0.2.25', ''), /Conflicting/);
});

// Exercise the actual publisher against an in-memory GitHub release API. Keys are
// generated for each fixture and never use the application's signing material.
function githubFixture() {
  const releases = new Map(), calls = [];
  const mock = { releases, calls, fail: null, corrupt: null };
  mock.run = async (command, args) => {
    assert.equal(command, 'gh');
    assert.equal(args[0], 'release');
    assert.deepEqual(args.slice(-2), ['--repo', 'saadqc/marinashell']);
    const [operation, tag] = args.slice(1), options = args.slice(3, -2);
    calls.push({ operation, tag, options });
    if (mock.fail?.(operation, tag, options)) throw new Error('Injected publication failure');
    const release = releases.get(tag);
    if (operation === 'view') {
      if (!release) throw Object.assign(new Error('Missing release'), { stderr: 'release not found' });
      const assets = [...release.assets].map(([name, bytes]) => ({ name, size: bytes.length, digest: `sha256:${digest(bytes)}` }));
      if (mock.corrupt) mock.corrupt(tag, assets);
      return { stdout: JSON.stringify({ isDraft: release.isDraft, isPrerelease: release.isPrerelease, assets, url: `https://github.com/saadqc/marinashell/releases/tag/${tag}` }) };
    }
    if (operation === 'create') {
      assert.equal(release, undefined, 'existing releases must not be recreated');
      releases.set(tag, { isDraft: options.includes('--draft'), isPrerelease: options.includes('--prerelease'), assets: new Map() });
    } else if (operation === 'upload') {
      assert.ok(release);
      const paths = options.filter(value => !value.startsWith('--'));
      if (tag === 'updater') {
        assert.deepEqual(paths.map(file => path.basename(file)), ['latest.json'], 'the feed must be one atomic envelope');
        assert.equal(releases.get('v0.2.25').isDraft, false, 'the immutable release must already be public');
      }
      for (const file of paths) release.assets.set(path.basename(file), await fs.readFile(file));
    } else if (operation === 'download') {
      assert.ok(release);
      const name = options[options.indexOf('--pattern') + 1], destination = options[options.indexOf('--dir') + 1];
      assert.ok(release.assets.has(name), 'downloaded asset must exist');
      await fs.writeFile(path.join(destination, name), release.assets.get(name));
    } else if (operation === 'edit') {
      assert.ok(release);
      if (options.includes('--draft=false')) release.isDraft = false;
      if (options.includes('--prerelease')) release.isPrerelease = true;
    } else assert.fail(`Unexpected release operation: ${operation}`);
    return { stdout: '' };
  };
  return mock;
}

async function publicationFixture(t) {
  const directory = await fixture(t), keys = crypto.generateKeyPairSync('ed25519'), mock = githubFixture();
  const notesFile = path.join(directory, 'notes.md');
  await fs.writeFile(notesFile, 'Original release notes');
  const options = { directory, version: '0.2.25', notesFile, privateKey: keys.privateKey, publicKey: keys.publicKey, run: mock.run };
  return { ...options, mock, options, keys };
}

test('publication verifies every immutable asset before publishing the atomic feed', async t => {
  const { options, mock, keys } = await publicationFixture(t);
  const result = await publish(options);
  const release = mock.releases.get('v0.2.25'), feed = mock.releases.get('updater');
  assert.equal(release.isDraft, false);
  assert.equal(feed.isDraft, false);
  assert.equal(feed.isPrerelease, true);
  assert.equal(result.assets.length, 8);
  assert.equal(release.assets.size, 8);
  assert.deepEqual([...feed.assets.keys()], ['latest.json']);
  assert.deepEqual(feed.assets.get('latest.json'), release.assets.get('latest.json'));
  const manifest = verifyEnvelope(feed.assets.get('latest.json'), keys.publicKey).manifest;
  assert.equal(manifest.version, '0.2.25');
  for (const artifact of Object.values(manifest.platforms)) {
    const bytes = release.assets.get(decodeURIComponent(new URL(artifact.url).pathname.split('/').pop()));
    assert.equal(digest(bytes), artifact.sha256);
    assert.equal(bytes.length, artifact.size);
  }
  const checksums = release.assets.get('SHA256SUMS.txt').toString().trim().split('\n');
  for (const line of checksums) {
    const [hash, name] = line.split('  ');
    assert.equal(digest(release.assets.get(name)), hash);
  }
  const verified = mock.calls.findLastIndex(call => call.operation === 'view' && call.tag === 'v0.2.25');
  const feedUpload = mock.calls.findIndex(call => call.operation === 'upload' && call.tag === 'updater');
  assert.ok(verified < feedUpload);
});

test('publication retry preserves the immutable signed envelope after version publication', async t => {
  const { options, mock, notesFile } = await publicationFixture(t);
  mock.fail = (operation, tag) => operation === 'create' && tag === 'updater';
  await assert.rejects(publish(options), /Injected/);
  const original = Buffer.from(mock.releases.get('v0.2.25').assets.get('latest.json'));
  assert.equal(mock.releases.get('v0.2.25').isDraft, false);
  await fs.writeFile(notesFile, 'Changed notes must not rewrite an immutable release');
  mock.fail = null;
  await publish(options);
  assert.deepEqual(mock.releases.get('updater').assets.get('latest.json'), original);
  assert.deepEqual(mock.releases.get('v0.2.25').assets.get('latest.json'), original);
  assert.equal(mock.calls.filter(call => call.operation === 'upload' && call.tag === 'v0.2.25').length, 1);
  await publish(options);
  assert.deepEqual(mock.releases.get('updater').assets.get('latest.json'), original);
});

test('publication resumes a feed draft left empty by an interrupted first upload', async t => {
  const { options, mock } = await publicationFixture(t);
  mock.fail = (operation, tag) => operation === 'upload' && tag === 'updater';
  await assert.rejects(publish(options), /Injected/);
  assert.equal(mock.releases.get('updater').isDraft, true);
  assert.equal(mock.releases.get('updater').assets.size, 0);
  mock.fail = null;
  await publish(options);
  assert.equal(mock.releases.get('updater').isDraft, false);
  assert.equal(mock.calls.filter(call => call.operation === 'create' && call.tag === 'updater').length, 1);
});

test('publication never moves a newer signed feed backward', async t => {
  const { options, mock, keys } = await publicationFixture(t);
  const newer = encodeEnvelope(signManifest({ schema: 1, version: '0.2.26', platforms: {} }, keys.privateKey, keys.publicKey));
  mock.releases.set('updater', { isDraft: false, isPrerelease: true, assets: new Map([['latest.json', newer]]) });
  await assert.rejects(publish(options), /backward/);
  assert.deepEqual(mock.releases.get('updater').assets.get('latest.json'), newer);
  assert.equal(mock.calls.some(call => ['upload', 'create', 'edit'].includes(call.operation)), false);
});

test('a bad uploaded artifact prevents version and feed publication', async t => {
  const { options, mock } = await publicationFixture(t);
  mock.corrupt = (tag, assets) => { if (tag === 'v0.2.25' && assets.length) assets[0].digest = `sha256:${'0'.repeat(64)}`; };
  await assert.rejects(publish(options), /asset verification failed/);
  assert.equal(mock.releases.get('v0.2.25').isDraft, true);
  assert.equal(mock.releases.has('updater'), false);
  assert.equal(mock.calls.some(call => call.operation === 'edit'), false);
});

test('an invalid signed feed and authentication errors fail closed without publication', async t => {
  const { options, mock, keys } = await publicationFixture(t);
  const envelope = JSON.parse(encodeEnvelope(signManifest({ schema: 1, version: '0.2.24', platforms: {} }, keys.privateKey, keys.publicKey)));
  envelope.payload = Buffer.from('{"schema":1,"version":"0.2.1"}').toString('base64');
  mock.releases.set('updater', { isDraft: false, isPrerelease: true, assets: new Map([['latest.json', Buffer.from(JSON.stringify(envelope))]]) });
  await assert.rejects(publish(options), /signature is invalid/);
  assert.equal(mock.calls.some(call => ['upload', 'create', 'edit'].includes(call.operation)), false);
  await assert.rejects(publish({ ...options, run: async () => { throw Object.assign(new Error('Not authorized'), { stderr: 'HTTP 403' }); } }), /Not authorized/);
});
