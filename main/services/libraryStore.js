const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

// Independent of session restoration and plugin installation directories.
function createLibraryStore(name, root = path.join(os.homedir(), '.marinashell')) {
  const file = path.join(root, `${name}.json`);
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  function write(items) {
    if (!Array.isArray(items)) throw new Error('Expected a library list');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
    return items;
  }
  function upsert(item) {
    const items = read();
    const next = { ...item, id: item.id || randomUUID(), updatedAt: new Date().toISOString() };
    const index = items.findIndex(entry => entry.id === next.id);
    if (index < 0) items.push(next); else items[index] = next;
    write(items);
    return next;
  }
  return { read, write, upsert, remove: id => write(read().filter(item => item.id !== id)), file };
}
module.exports = { createLibraryStore };
