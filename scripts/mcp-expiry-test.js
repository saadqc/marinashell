const assert = require('assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore } = require('../plugins/mcp-server/store'); const { createTools } = require('../plugins/mcp-server/tools');
const { createLibraryStore } = require('../main/services/libraryStore'); const { createConfigurationLibrary } = require('../plugins/run-configurations/lifecycle');
const { normalize } = require('../plugins/run-configurations/configuration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-mcp-expiry-')); let now = Date.now();
async function test() {
  const store = createStore({ root, secureStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() } });
  const client = store.add('Fixture'); const configs = createConfigurationLibrary({ root, now: () => now });
  const manager = { configs, list: () => [] };
  const service = { manager, normalize, mcpExpiry: () => 3600000 };
  const engine = createTools({ store, library: createLibraryStore('saved-groups', root), getService: name => name === 'runs' ? service : null, broker: { request: async action => action === 'snapshot' ? { stamp: 'fixture', projects: [], terminals: [] } : true } });
  store.policy(client.id, { 'configurations.create': 'allow', 'configurations.list': 'allow' }, { configurations: ['*'], hosts: ['__local__'], projects: ['*'], scratchpad: false, futureConfigurations: true }, engine.names, {}, []);
  const configuration = { name: 'Agent fixture', host: '__local__', type: 'shell', mode: 'commands', target: 'true', cwd: root };
  const created = await engine.execute(client.id, 'configurations.create', { configuration, requestId: 'create-fixture' });
  assert.equal(created.createdVia, 'mcp'); assert.equal(Date.parse(created.expiresAt) - now, 3600000);
  const permanent = await engine.execute(client.id, 'configurations.create', { configuration: { ...configuration, expiryDurationMs: null }, requestId: 'create-permanent' }); assert.equal(permanent.expiresAt, null);
  await assert.rejects(engine.execute(client.id, 'configurations.create', { configuration: { ...configuration, createdVia: 'ui' }, requestId: 'spoof-origin' }), { code: 'INVALID_ARGUMENT' });
  now += 3600001; configs.cleanup(); assert(!configs.read().some(c => c.id === created.id));
  await assert.rejects(engine.execute(client.id, 'configurations.create', { configuration, requestId: 'create-fixture' }), { code: 'ALREADY_REQUESTED' });
  assert(!configs.read().some(c => c.id === created.id), 'Receipt replay cannot resurrect an expired definition');
  const list = await engine.execute(client.id, 'configurations.list', { createdVia: 'mcp' }); assert.equal(list.items.length, 1);
  console.log('PASS: actual MCP tool validation, trusted origin, default/Never expiry, origin filter and duplicate receipts after retirement');
}
test().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
