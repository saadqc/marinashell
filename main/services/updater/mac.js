'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const tar = require('tar');
const locks = require('./lock');
const { archiveEntry, verifyArtifact } = require('./security');
const exec = promisify(execFile);
async function validateBundle(bundle, config, version, run = exec) {
  const plist = path.join(bundle, 'Contents/Info.plist');
  const read = async key => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { timeout: 30000 })).stdout.trim();
  if (await read('CFBundleIdentifier') !== config.appId || await read('CFBundleShortVersionString') !== version) throw new Error('Update application identity/version does not match.');
  const executable = await read('CFBundleExecutable');
  if (!/^[A-Za-z0-9 _.-]+$/.test(executable) || executable === '.' || executable === '..') throw new Error('Invalid app executable.');
  const binary = path.join(bundle, 'Contents/MacOS', executable);
  if ((await run('/usr/bin/lipo', ['-archs', binary], { timeout: 30000 })).stdout.trim() !== 'arm64') throw new Error('Update must be an Apple silicon application.');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 60000, maxBuffer: 1024 * 1024 });
  return executable;
}
async function validateLinks(root) {
  root = await fs.realpath(root);
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(file);
        if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Update contains a link outside the application.');
      } else if (entry.isDirectory()) await walk(file);
      else if (!entry.isFile()) throw new Error('Update contains a special file.');
    }
  }
  await walk(root);
}
async function extractArchive(archive, destination, config) {
  let count = 0, expanded = 0, invalid;
  await new Promise((resolve, reject) => {
    const input = require('node:fs').createReadStream(archive);
    const parser = new tar.Parser({ strict: true });
    const fail = error => { input.destroy(); reject(error); };
    input.on('error', fail); parser.on('error', fail); parser.on('end', resolve);
    parser.on('entry', entry => {
      try {
        archiveEntry(entry, config.appName);
        if (++count > 50000 || (expanded += Number(entry.size) || 0) > 3 * 1024 ** 3) throw new Error('Update archive exceeds extraction limits.');
        entry.resume();
      } catch (error) { parser.abort(error); }
    });
    input.pipe(parser);
  });
  await tar.x({ file: archive, cwd: destination, strict: true, preservePaths: false, noChmod: false, filter: (_name, entry) => {
    try { archiveEntry(entry, config.appName); return !invalid; }
    catch (error) { invalid = error; return false; }
  } });
  if (invalid) throw invalid;
  const bundle = path.join(destination, config.appName);
  await validateLinks(bundle);
  return bundle;
}
async function prepareMacUpdate({ archive, artifact, manifest, config, appPath, cache, execPath = process.execPath }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Automatic installation is available on Apple silicon macOS.');
  const target = path.resolve(appPath, '../../..');
  const actual = await fs.realpath(target);
  if (actual !== target || !target.endsWith('.app') || target.startsWith('/Volumes/') || target.includes('/AppTranslocation/')) throw new Error('Move MarinaShell to a writable Applications folder before updating.');
  await fs.access(path.dirname(target), require('node:fs').constants.W_OK);
  await verifyArtifact(archive, artifact);
  const nonce = crypto.randomBytes(24).toString('hex');
  const lock = await locks.acquire(target, nonce);
  let transaction;
  try {
    transaction = await fs.mkdtemp(path.join(path.dirname(target), '.marinashell-update-'));
    await fs.chmod(transaction, 0o700);
    const extraction = path.join(transaction, 'unpack'); await fs.mkdir(extraction, { mode: 0o700 });
    const staged = await extractArchive(archive, extraction, config);
    const executable = await validateBundle(staged, config, manifest.version);
    // Recheck the archive after extraction, before allowing a restart.
    await verifyArtifact(archive, artifact);
    const helper = path.join(cache, 'install.cjs');
    await fs.copyFile(path.join(__dirname, 'install-helper.js'), helper); await fs.chmod(helper, 0o600);
    const record = {
      target, staged, transaction, backup: path.join(transaction, 'previous.app'),
      parentPid: process.pid, nonce, lock,
      appId: config.appId, version: manifest.version, executable,
      receipt: path.join(transaction, 'receipt.json'), ack: path.join(transaction, 'ack.json'),
      ready: path.join(transaction, 'ready'), cancel: path.join(transaction, 'cancel'),
      env: { HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
    };
    const recordPath = path.join(cache, 'install.json'); await fs.writeFile(recordPath, JSON.stringify(record), { mode: 0o600 });
    return { record, async launch() {
      const child = spawn(execPath, [helper, recordPath], { detached: true, stdio: 'ignore', env: { ...record.env, ELECTRON_RUN_AS_NODE: '1' } });
      let error; child.once('error', value => { error = value; }); child.unref();
      for (let i = 0; i < 100; i++) {
        if (error) throw error;
        if (await fs.readFile(record.ready, 'utf8').catch(() => '') === record.nonce) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Update installer could not start.');
    }, async cancel() { await fs.writeFile(record.cancel, 'cancel', { mode: 0o600 }); } };
  } catch (error) { if (transaction) await fs.rm(transaction, { recursive: true, force: true }); await locks.release(lock, nonce); throw error; }
}
module.exports = { validateBundle, validateLinks, extractArchive, prepareMacUpdate };
