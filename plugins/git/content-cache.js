// Immutable commit contents only. Failures are retried, and concurrent readers
// share one load. Limit retained text so large reviews cannot grow indefinitely.
function createContentCache({ maxBytes = 32 * 1024 * 1024, maxEntries = 256 } = {}) {
  const values = new Map(); const pending = new Map(); let bytes = 0;
  async function read(key, load) {
    if (values.has(key)) { const item = values.get(key); values.delete(key); values.set(key, item); return item.text; }
    if (pending.has(key)) return pending.get(key);
    const operation = Promise.resolve().then(load).then(text => {
      const size = text.length * 2;
      if (size <= maxBytes) {
        while (values.size && (bytes + size > maxBytes || values.size >= maxEntries)) {
          const oldest = values.keys().next().value; bytes -= values.get(oldest).size; values.delete(oldest);
        }
        values.set(key, { text, size }); bytes += size;
      }
      return text;
    }).finally(() => pending.delete(key));
    pending.set(key, operation); return operation;
  }
  return { read };
}
module.exports = { createContentCache };
