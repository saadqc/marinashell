const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { directoryArgument, resolveDirectory, createDirectoryHandoff } = require('../main/services/openDirectory');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marina-folder-'));
  try {
    const folder = path.join(root, "Folder 'quoted' 日本語 $(touch NO_EXECUTION)"); await fs.mkdir(folder);
    assert.equal(directoryArgument(['app', '--open-directory', folder]), folder);
    assert.equal(directoryArgument(['app']), null);
    assert.throws(() => directoryArgument(['app', '--open-directory']));
    assert.throws(() => directoryArgument(['app', '--open-directory', folder, '--open-directory', folder]));
    for (const invalid of ['relative', 'ssh://host/folder', '/tmp/line\nbreak', '/tmp/zero\0byte']) await assert.rejects(resolveDirectory(invalid));
    await assert.rejects(resolveDirectory(path.join(root, 'missing')));
    const file = path.join(root, 'file'); await fs.writeFile(file, ''); await assert.rejects(resolveDirectory(file));
    const alias = path.join(root, 'alias'); await fs.symlink(folder, alias); const canonical = await fs.realpath(folder);
    assert.equal(await resolveDirectory(alias), canonical);
    const sent = [], errors = []; let shown = 0;
    const queue = createDirectoryHandoff({ show: () => { shown++; }, send: p => sent.push(p), report: message => errors.push(message) });
    await queue.enqueue(['app', '--open-directory', alias]); assert.equal(sent.length, 0);
    queue.setReady(true); assert.deepEqual(sent, [canonical]);
    await queue.enqueue(['app', '--open-directory', folder]); assert.deepEqual(sent, [canonical, canonical]);
    queue.setReady(false); await queue.enqueue(['app', '--open-directory', folder]); assert.equal(sent.length, 2);
    queue.setReady(true); assert.equal(sent.length, 3); assert.equal(shown, 3);
    await queue.enqueue(['app', '--open-directory', 'relative']); assert.equal(errors.length, 1); assert.equal(sent.length, 3);
    assert(!await fs.stat(path.join(root, 'NO_EXECUTION')).catch(() => null));
    console.log('PASS: local directory argv validation, literal special characters, canonical paths and startup/reload request queues');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
