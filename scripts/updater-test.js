'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const tar = require('tar');
const { verifyManifest, verifyArtifact, newer, archiveEntry, releaseURL, redirectURL } = require('../main/services/updater/security');
const { UpdateService } = require('../main/services/updater/service');
const { extractArchive } = require('../main/services/updater/mac');
const { transact } = require('../main/services/updater/install-helper');
const locks = require('../main/services/updater/lock');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const artifact = Buffer.from('verified update');
const repository = 'example/editor';
const base = { schema: 1, version: '1.2.0', notes: 'New update', platforms: { 'darwin-arm64': { url: 'https://github.com/example/editor/releases/download/v1.2.0/editor.app.tar.gz', size: artifact.length, sha256: crypto.createHash('sha256').update(artifact).digest('hex'), kind: 'app-tar-gz' } } };
const bytes = Buffer.from(JSON.stringify(base)), signature = Buffer.from(crypto.sign(null, bytes, privateKey).toString('base64'));
const envelope = Buffer.from(JSON.stringify({ schema: 1, payload: bytes.toString('base64'), signature: signature.toString() }));
const config = { repository, publicKey, feed: 'https://github.com/example/editor/releases/download/updater/latest.json', appName: 'MarinaShell.app' };
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marina-updater-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
test('signed metadata authenticates version, hash, size, and URL; forged data is rejected', () => {
  assert.equal(verifyManifest(bytes, signature, publicKey, repository).version, '1.2.0');
  assert.throws(() => verifyManifest(Buffer.from(bytes.toString().replace('1.2.0', '9.9.9')), signature, publicKey, repository), /signature/);
  assert.throws(() => verifyManifest(bytes, Buffer.alloc(88, 'A'), publicKey, repository), /signature/);
  const foreign = { ...base, platforms: { 'darwin-arm64': { ...base.platforms['darwin-arm64'], url: 'https://attacker.invalid/update' } } };
  const data = Buffer.from(JSON.stringify(foreign)); assert.throws(() => verifyManifest(data, Buffer.from(crypto.sign(null, data, privateKey).toString('base64')), publicKey, repository), /official release/);
});
test('release and redirect URLs require HTTPS and exact trusted hosts', () => {
  for (const url of ['http://github.com/example/editor/releases/download/v/a', 'https://github.com/example/editor-other/releases/download/v/a', 'https://github.com@example.com/example/editor/releases/download/v/a']) assert.throws(() => releaseURL(url, repository));
  assert.throws(() => redirectURL('https://github.com.evil.test/update'));
  assert.throws(() => redirectURL('file:///tmp/update'));
  assert.equal(redirectURL('https://release-assets.githubusercontent.com/a?token=x').protocol, 'https:');
});
test('versions do not downgrade or confuse lexical ordering', () => {
  assert(newer('1.10.0', '1.9.9')); assert(!newer('1.2.0', '1.2.0')); assert(!newer('1.1.9', '1.2.0')); assert.throws(() => newer('1.2.3-bad', '1.0.0'));
});
test('archive paths and internal framework links are constrained', () => {
  archiveEntry({ path: 'MarinaShell.app/Contents/Frameworks/A.framework/A', type: 'SymbolicLink', linkpath: 'Versions/Current/A' }, config.appName);
  for (const entry of [{ path: '../x', type: 'File' }, { path: '/MarinaShell.app/x', type: 'File' }, { path: 'MarinaShell.app/x', type: 'SymbolicLink', linkpath: '../../escape' }, { path: 'MarinaShell.app/x', type: 'Link', linkpath: 'MarinaShell.app/y' }, { path: 'MarinaShell.app/x', type: 'FIFO' }]) assert.throws(() => archiveEntry(entry, config.appName));
});
test('artifact is reverified and tampering rejected', async t => {
  const root = await temporary(t), file = path.join(root, 'artifact'); await fs.writeFile(file, artifact);
  await verifyArtifact(file, base.platforms['darwin-arm64']); await fs.writeFile(file, 'tampered'); await assert.rejects(verifyArtifact(file, base.platforms['darwin-arm64']), /checksum/);
});
async function service(t, { current = '1.0.0', bad = false, fail = false, automatic = true } = {}) {
  const root = await temporary(t); let calls = 0, installed = 0;
  const instance = new UpdateService({ version: current, cache: root, packaged: true, platform: 'darwin', arch: 'arm64', config,
    download: async (url, file, options) => { calls++; if (fail && url.endsWith('.tar.gz')) throw new Error('Network unavailable'); const content = url.endsWith('.json') ? envelope : bad ? Buffer.from('evil') : artifact; await fs.writeFile(file, content, { flag: 'wx', mode: 0o600 }); options.onProgress?.(content.length); },
    prepareRestart: async () => false, install: async () => { installed++; }
  }); await instance.init(); instance.stop(); await instance.configure({ automaticDownload: automatic });
  return { instance, calls: () => calls, installed: () => installed };
}
test('one concurrent check automatically downloads, verifies and waits for restart consent', async t => {
  const { instance, calls, installed } = await service(t); const first = instance.check(), second = instance.check(); assert.equal(first, second); await first;
  assert.equal(instance.snapshot().status, 'ready'); assert.equal(calls(), 2); assert.equal(installed(), 0); await instance.restart(); assert.equal(installed(), 0); assert.equal(instance.snapshot().status, 'ready');
});
test('manual download preference offers Update and persists', async t => {
  const { instance, calls } = await service(t, { automatic: false }); await instance.check(); assert.equal(instance.snapshot().status, 'available'); assert.equal(calls(), 1);
  await instance.update(); assert.equal(instance.snapshot().status, 'ready'); assert.equal(calls(), 2);
  assert.equal(JSON.parse(await fs.readFile(path.join(instance.cache, 'preferences.json'))).automaticDownload, false);
});
test('current version does not download artifacts', async t => { const { instance, calls } = await service(t, { current: '1.2.0' }); await instance.check(); assert.equal(instance.snapshot().status, 'current'); assert.equal(calls(), 1); });
test('network and integrity failures cannot become restart-ready', async t => {
  for (const options of [{ bad: true }, { fail: true }]) { const { instance, installed } = await service(t, options); await instance.check(); assert.equal(instance.snapshot().status, 'error'); await instance.restart(); assert.equal(installed(), 0); }
});
test('safe extraction preserves normal internal symbolic links', async t => {
  const root = await temporary(t), source = path.join(root, 'source'), out = path.join(root, 'out');
  await fs.mkdir(path.join(source, config.appName, 'Contents', 'Version'), { recursive: true }); await fs.mkdir(out);
  await fs.writeFile(path.join(source, config.appName, 'Contents', 'Version', 'binary'), 'data');
  await fs.symlink('Version/binary', path.join(source, config.appName, 'Contents', 'current'));
  const file = path.join(root, 'update.tar.gz'); await tar.c({ cwd: source, file, gzip: true, portable: true }, [config.appName]);
  await extractArchive(file, out, config); assert.equal(await fs.readFile(path.join(out, config.appName, 'Contents', 'current'), 'utf8'), 'data');
});
async function transaction(t) {
  const root = await temporary(t), target = path.join(root, 'MarinaShell.app'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'version'), 'old');
  const directory = await fs.mkdtemp(path.join(root, '.marinashell-update-')), staged = path.join(directory, 'next.app'); await fs.mkdir(staged); await fs.writeFile(path.join(staged, 'version'), 'new');
  const nonce = crypto.randomBytes(24).toString('hex'), lock = await locks.acquire(target, nonce);
  return { target, staged, transaction: directory, backup: path.join(directory, 'previous.app'), receipt: path.join(directory, 'receipt.json'), ready: path.join(directory, 'ready'), cancel: path.join(directory, 'cancel'), ack: path.join(directory, 'ack.json'), parentPid: 123, nonce, lock, version: '1.2.0' };
}
test('atomic install preserves old app until acknowledged launch', async t => {
  const record = await transaction(t);
  await transact(record, { isAlive: () => false, verify: async bundle => assert.equal(await fs.readFile(path.join(bundle, 'version'), 'utf8'), 'new'), launch: async () => { assert.equal(await fs.readFile(path.join(record.backup, 'version'), 'utf8'), 'old'); await fs.writeFile(record.ack, JSON.stringify({ nonce: record.nonce, version: record.version })); }, wait: async () => {} });
  assert.equal(await fs.readFile(path.join(record.target, 'version'), 'utf8'), 'new'); assert.equal(await fs.stat(record.backup).catch(() => null), null);
});
test('failed updated launch rolls back the previous app', async t => {
  const record = await transaction(t); let rollback = false;
  await assert.rejects(transact(record, { isAlive: () => false, verify: async () => {}, launch: async (_bundle, value) => { if (value.rollback) rollback = true; else throw new Error('launch failure'); }, wait: async () => {} }), /launch failure/);
  assert(rollback); assert.equal(await fs.readFile(path.join(record.target, 'version'), 'utf8'), 'old'); assert.equal(await fs.stat(record.lock).catch(() => null), null);
});
test('cancel or still-running parent never replaces the application', async t => {
  const record = await transaction(t); await fs.writeFile(record.cancel, 'cancel');
  await transact(record, { isAlive: () => true, verify: async () => { throw new Error('must not install'); }, wait: async () => {} });
  assert.equal(await fs.readFile(path.join(record.target, 'version'), 'utf8'), 'old'); assert.equal(await fs.stat(record.transaction).catch(() => null), null);
});
test('installation locks reject concurrent operations', async t => {
  const root = await temporary(t), target = path.join(root, 'app.app'), nonce = crypto.randomBytes(24).toString('hex');
  const directory = await locks.acquire(target, nonce); await assert.rejects(locks.acquire(target, 'another'), /already preparing/); await locks.release(directory, nonce);
});

test('cleanup failure after startup acknowledgement retains working new app', async t => {
  const record = await transaction(t);
  const result = await transact(record, { isAlive: () => false, verify: async () => {}, launch: async () => { await fs.writeFile(record.ack, JSON.stringify({ nonce: record.nonce, version: record.version })); }, cleanup: async () => { throw new Error('cleanup denied'); }, wait: async () => {} });
  assert.equal(result.ok, true); assert.equal(result.cleanupError, 'cleanup denied'); assert.equal(await fs.readFile(path.join(record.target, 'version'), 'utf8'), 'new');
});
test('malformed archive rejects without an uncaught process exception', async t => {
  const root = await temporary(t); await fs.mkdir(path.join(root, 'Wrong.app')); const archive = path.join(root, 'wrong.tar.gz');
  await tar.c({ cwd: root, file: archive, gzip: true }, ['Wrong.app']);
  const out = path.join(root, 'out'); await fs.mkdir(out);
  await assert.rejects(extractArchive(archive, out, config), /Unsafe update archive path/);
});

test('extraction rejects duplicate paths, hard links, traversal and symlink ancestors before writing', async t => {
  const root = await temporary(t);
  const dir = name => ({ path: name, type: 'Directory', size: 0, mode: 0o755 });
  const app = config.appName;
  const cases = [
    [dir(app), dir(app)],
    [dir(app), { path: `${app}/link`, type: 'Link', linkpath: `${app}/file`, size: 0 }],
    [dir(app), { path: `${app}/../../escaped`, type: 'File', size: 0 }],
    [dir(app), dir(`${app}/real`), { path: `${app}/alias`, type: 'SymbolicLink', linkpath: 'real', size: 0 }, { path: `${app}/alias/file`, type: 'File', size: 0 }],
    [dir(app), { path: `${app}/alias`, type: 'SymbolicLink', linkpath: '../outside', size: 0 }],
    [dir(app), { path: `${app}/./alias`, type: 'SymbolicLink', linkpath: 'real', size: 0 }, { path: `${app}/alias/file`, type: 'File', size: 0 }],
    [dir(app), { path: `${app}/file`, type: 'File', size: 0 }, { path: `${app}//file`, type: 'File', size: 0 }],
    [dir(app), { path: `${app}/unknown`, type: 'File', size: 0, unknownType: true }]
  ];
  for (let i = 0; i < cases.length; i++) {
    const archive = path.join(root, `unsafe-${i}.tar.gz`), out = path.join(root, `out-${i}`); await fs.mkdir(out);
    const blocks = cases[i].map(entry => {
      const header = new tar.Header(entry); header.encode();
      if (entry.unknownType) {
        header.block[156] = 'Z'.charCodeAt(0); header.block.fill(32, 148, 156);
        const sum = header.block.reduce((total, byte) => total + byte, 0);
        header.block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      }
      return header.block;
    });
    await fs.writeFile(archive, require('node:zlib').gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
    await assert.rejects(extractArchive(archive, out, config), /duplicate|Unsupported|Unsafe/);
    assert.deepEqual(await fs.readdir(out), [], 'Archive preflight must reject before extraction');
  }
});
