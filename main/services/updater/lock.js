'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function lockPath(target) { return path.join(path.dirname(target), `.marinashell-update-lock-${crypto.createHash('sha256').update(target).digest('hex').slice(0, 16)}`); }
function alive(pid) { if (!Number.isSafeInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
async function acquire(target, nonce) {
  const directory = lockPath(target);
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await fs.readFile(path.join(directory, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!previous || alive(previous.pid) || (await fs.lstat(directory)).isSymbolicLink()) throw new Error('Another update is already preparing this application.');
    const stale = directory + '.stale-' + crypto.randomUUID();
    await fs.rename(directory, stale); await fs.rm(stale, { recursive: true, force: true });
    await fs.mkdir(directory, { mode: 0o700 });
  }
  await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ nonce, pid: process.pid }), { mode: 0o600 });
  return directory;
}
async function release(directory, nonce) {
  const owner = await fs.readFile(path.join(directory, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (owner?.nonce === nonce) await fs.rm(directory, { recursive: true, force: true });
}
module.exports = { acquire, release, lockPath };
