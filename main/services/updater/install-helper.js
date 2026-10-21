'use strict';
// Detached installer: only Node built-ins, loaded before the running bundle moves.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function transact(record, { verify, launch, wait = pause, isAlive = alive, cleanup = fs.rm } = {}) {
  const { target, staged, transaction, backup, receipt, ack, ready, cancel, nonce } = record;
  if (!path.isAbsolute(target) || !target.endsWith('.app') || path.dirname(transaction) !== path.dirname(target) || !path.basename(transaction).startsWith('.marinashell-update-') || backup !== path.join(transaction, 'previous.app') || !staged.startsWith(transaction + path.sep) || [receipt, ack, ready, cancel].some(file => path.dirname(file) !== transaction) || !/^[a-f0-9]{48}$/.test(nonce)) throw new Error('Invalid installer transaction.');
  if ((await fs.lstat(transaction)).isSymbolicLink() || (await fs.lstat(target)).isSymbolicLink()) throw new Error('Unsafe installer location.');
  const expectedLock = path.join(path.dirname(target), `.marinashell-update-lock-${crypto.createHash('sha256').update(target).digest('hex').slice(0, 16)}`);
  if (record.lock !== expectedLock) throw new Error('Invalid update lock.');
  const owner = await fs.readFile(path.join(record.lock, 'owner.json'), 'utf8').then(JSON.parse);
  if (owner.nonce !== nonce) throw new Error('Update lock changed.');
  await fs.writeFile(path.join(record.lock, 'owner.json'), JSON.stringify({ nonce, pid: process.pid }), { mode: 0o600 });
  const releaseLock = async () => { const current = await fs.readFile(path.join(record.lock, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null); if (current?.nonce === nonce) await fs.rm(record.lock, { recursive: true, force: true }); };
  const canceled = async () => { await fs.rm(transaction, { recursive: true, force: true }); await releaseLock(); return { canceled: true }; };
  await fs.writeFile(ready, nonce, { mode: 0o600 });
  let closed = false;
  for (let i = 0; i < 1200; i++) {
    if (await fs.stat(cancel).catch(() => null)) return canceled();
    if (!isAlive(record.parentPid)) { closed = true; break; }
    await wait(100);
  }
  if (!closed) return canceled();
  let moved = false, replaced = false, committed = false, child;
  try {
    await verify(staged, record);
    await fs.rename(target, backup); moved = true;
    await fs.rename(staged, target); replaced = true;
    await verify(target, record);
    child = await launch(target, record);
    let acknowledged = false;
    for (let i = 0; i < 600; i++) {
      if (typeof child?.exitCode === 'number') throw new Error('Updated application exited before startup completed.');
      const value = await fs.readFile(ack, 'utf8').then(JSON.parse).catch(() => null);
      if (value?.nonce === nonce && value?.version === record.version) { acknowledged = true; break; }
      await wait(100);
    }
    if (!acknowledged) throw new Error('Updated application did not complete startup.');
    committed = true;
    await fs.writeFile(receipt, JSON.stringify({ ok: true, version: record.version }), { mode: 0o600 });
    await cleanup(backup, { recursive: true, force: true });
    await cleanup(transaction, { recursive: true, force: true });
    await releaseLock();
    return { ok: true };
  } catch (error) {
    if (committed) { await releaseLock().catch(() => {}); return { ok: true, cleanupError: error.message }; }
    if (child?.pid) { try { child.kill('SIGTERM'); } catch {} await wait(1000); if (isAlive(child.pid)) { try { child.kill('SIGKILL'); } catch {} await wait(100); } }
    if (replaced) await fs.rename(target, path.join(transaction, 'failed.app'));
    if (moved) await fs.rename(backup, target);
    await fs.writeFile(receipt, JSON.stringify({ ok: false, error: error.message }), { mode: 0o600 });
    if (moved) await launch(target, { ...record, rollback: true }).catch(() => {});
    await releaseLock();
    throw error;
  }
}
async function verify(bundle, record) {
  const plist = path.join(bundle, 'Contents/Info.plist');
  for (const [key, expected] of [['CFBundleIdentifier', record.appId], ['CFBundleShortVersionString', record.version], ['CFBundleExecutable', record.executable]]) {
    const { stdout } = await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { timeout: 30000 });
    if (stdout.trim() !== expected) throw new Error('Staged app identity changed.');
  }
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 60000 });
}
async function launch(bundle, record) {
  const env = { ...record.env };
  if (!record.rollback) { env.MARINASHELL_UPDATE_ACK = record.ack; env.MARINASHELL_UPDATE_NONCE = record.nonce; }
  const child = spawn(path.join(bundle, 'Contents/MacOS', record.executable), [], { env, detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); return child;
}
if (require.main === module) fs.readFile(process.argv[2], 'utf8').then(JSON.parse).then(record => transact(record, { verify, launch })).catch(() => { process.exitCode = 1; });
module.exports = { transact };
