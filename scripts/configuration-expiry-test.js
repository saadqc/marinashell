const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfigurationLibrary } = require('../plugins/run-configurations/lifecycle');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-expiry-'));
let clock = Date.parse('2026-10-17T00:00:00Z');
const active = new Set(); const removed = [];
const make = () => createConfigurationLibrary({ root, now: () => clock, busy: id => active.has(id), retired: id => removed.push(id) });
try {
  const library = make();
  const input = { name: 'Fixture', type: 'shell', mode: 'commands', target: 'true', cwd: root };
  const permanent = library.save(input, { origin: 'ui' });
  assert.equal(permanent.expiresAt, null);
  const mcp = library.save({ ...input, createdVia: 'ui', createdAt: 'forged' }, { origin: 'mcp', defaultExpiryMs: 3600000 });
  assert.equal(mcp.createdVia, 'mcp');
  assert.equal(mcp.createdAt, '2026-10-17T00:00:00.000Z');
  clock += 1000;
  assert.equal(library.save({ ...mcp, name: 'Edited', createdVia: 'ui' }).expiresAt, mcp.expiresAt, 'Ordinary edits cannot extend expiry');
  assert.equal(library.save({ ...mcp, name: 'Edited', createdVia: 'ui' }).createdVia, 'mcp');
  active.add(mcp.id); clock += 3600000;
  assert.throws(() => library.assertRunnable(mcp.id), /expired/);
  assert(library.read().some(c => c.id === mcp.id), 'Active and unknown runs retain definitions');
  const renewed = library.save(mcp, { renew: true });
  assert.equal(Date.parse(renewed.expiresAt), clock + 3600000);
  clock += 3600001; active.clear();
  assert(!make().read().some(c => c.id === mcp.id), 'A restarted app cleans expired definitions');
  assert(removed.includes(mcp.id));
  assert.throws(() => library.save(mcp), /expired/, 'A stale draft cannot resurrect a removed definition');
  for (const ttl of [900000, 3600000, 10800000, 120000]) {
    const c = library.save({ ...input, expiryDurationMs: ttl }, { origin: 'ui' });
    assert.equal(Date.parse(c.expiresAt), clock + ttl);
    const saved = library.save({ ...c, expiryDurationMs: null }); assert.equal(saved.expiresAt, null);
  }
  assert.throws(() => library.save({ ...input, expiryDurationMs: -1 }), /Expiry/);
  const existing = { ...input, id: 'legacy' };
  library.write([...library.read(), existing]);
  assert.equal(library.save(existing).createdVia, 'unknown');
  assert.equal(library.save(existing).expiresAt, null);
  const partial = library.save({ ...input, expiryDurationMs: 60000 }); clock += 60001;
  const interrupted = createConfigurationLibrary({ root, now: () => clock, retired: () => { throw new Error('fixture interruption'); } });
  assert.throws(() => interrupted.cleanup(), /fixture interruption/);
  assert(!make().read().some(c => c.id === partial.id), 'Persisted retirement intent recovers after an interrupted project unlink');
  const { removeConfigurationLinks } = require('../main/services/configurationLinks');
  const linked = removeConfigurationLinks([{ configurationIds: ['keep', 'expired'], tabs: [{ configurationId: 'expired', runId: 'historical' }] }], new Set(['expired']))[0];
  assert.deepEqual(linked.configurationIds, ['keep']); assert.equal(linked.tabs[0].configurationId, ''); assert.equal(linked.tabs[0].runId, 'historical');
  console.log('PASS: expiry durations, trusted provenance, legacy compatibility, renewal, restart cleanup, active-run retention and stale-draft rejection');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
