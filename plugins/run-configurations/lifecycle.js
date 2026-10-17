const fs = require('fs');
const { createLibraryStore } = require('../../main/services/libraryStore');
const { normalize } = require('./configuration');
const expired = (config, now = Date.now()) => Boolean(config.expiresAt && Date.parse(config.expiresAt) <= now);
function duration(value) {
  if (value === null || value === undefined || value === 0) return null;
  if (!Number.isSafeInteger(value) || value < 60000 || value > 365 * 86400000) throw new Error('Expiry must be between one minute and one year, or Never');
  return value;
}
function createConfigurationLibrary({ root, now = Date.now, busy = () => false, retired = () => {} }) {
  const library = createLibraryStore('run-configurations', root);
  const removals = createLibraryStore('retired-configurations', root);
  let cleaning = false;
  const backup = () => {
    if (fs.existsSync(library.file) && !fs.existsSync(library.file + '.before-expiry')) fs.copyFileSync(library.file, library.file + '.before-expiry', fs.constants.COPYFILE_EXCL);
  };
  function cleanup() {
    if (cleaning) return;
    cleaning = true;
    try {
      const pending = removals.read().filter(item => !item.done);
      for (const item of library.read()) if (expired(item, now()) && !busy(item.id) && !pending.some(p => p.id === item.id)) pending.push({ id: item.id });
      if (!pending.length) return;
      // Persist intent before touching either definitions or project links.
      removals.write([...removals.read().filter(item => item.done), ...pending]);
      for (const item of pending) {
        if (busy(item.id)) continue;
        retired(item.id);
        backup(); library.remove(item.id);
        removals.upsert({ id: item.id, done: true });
      }
    } finally { cleaning = false; }
  }
  function save(input, { origin = 'unknown', defaultExpiryMs = null, renew = false, raw = false } = {}) {
    const prior = library.read().find(c => c.id === input.id);
    const ttl = duration(Object.hasOwn(input, 'expiryDurationMs') ? input.expiryDurationMs : prior?.expiryDurationMs ?? defaultExpiryMs);
    const changed = !prior || ttl !== (prior.expiryDurationMs ?? null) || renew;
    const next = { ...(raw ? input : normalize(input)),
      createdAt: prior ? prior.createdAt || null : new Date(now()).toISOString(),
      createdVia: prior ? prior.createdVia || 'unknown' : origin,
      expiryDurationMs: ttl,
      expiresAt: changed ? ttl === null ? null : new Date(now() + ttl).toISOString() : prior.expiresAt || null
    };
    // A stale draft may not resurrect an expired entry already being removed.
    if (removals.read().some(c => c.id === next.id)) throw new Error('Configuration expired; create a new configuration');
    backup(); return library.upsert(next);
  }
  function assertRunnable(id) {
    const c = library.read().find(item => item.id === id);
    if (c && expired(c, now())) throw new Error('Configuration expired. Renew it or choose Keep permanently before running or restarting.');
    return c;
  }
  return { file: library.file, read() { cleanup(); return library.read(); }, save,
    upsert: input => save(input, { raw: true }),
    remove(id) { if (busy(id)) throw new Error('Stop this configuration’s runs before deleting it'); removals.upsert({ id }); cleanup(); },
    write: items => { backup(); return library.write(items); }, cleanup, assertRunnable };
}
module.exports = { createConfigurationLibrary, expired, duration };
