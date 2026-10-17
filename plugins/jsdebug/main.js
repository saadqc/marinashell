const { createDebugStore } = require('../pydebug/store');
const { createLibraryStore } = require('../../main/services/libraryStore');
const { createAdapter } = require('./adapter');
const { createJsDebugManager } = require('./session-manager');

module.exports = function activate({ registerIpc, registerService, registerDebugger, getService, getPlugins, getMainWindow, registerShutdown, registerActivation }) {
  const store = createDebugStore(undefined, 'jsdebug');
  const preferences = createLibraryStore('jsdebug-settings');
  const adapter = createAdapter({ settings: () => preferences.read()[0] || {} }); let manager; let enabled = true; let monitoring = false;
  const changed = () => { getMainWindow()?.webContents.send('jsdebug:changed'); getService('runs')?.changed(); };
  function prerequisite() {
    for (const id of ['editor', 'run-configurations']) {
      if (!getPlugins().some(p => p.id === id && p.enabled && p.loaded && !p.error)) throw new Error(`Enable ${id === 'editor' ? 'Editor' : 'Run Configurations'} in Settings to use JSDebug`);
    }
    return getService('runs');
  }
  function ensureManager() {
    const service = prerequisite();
    manager ||= createJsDebugManager({ runs: service.manager, store, adapter, changed, openTransport: service.openDebugTransport });
    return manager;
  }
  function ipc(name, handler) {
    registerIpc(name, async (_event, payload = {}) => {
      try { return { ok: true, ...(await handler(payload)) }; } catch (error) { return { ok: false, error: error.message }; }
    });
  }
  ipc('adapter-status', () => ({ status: adapter.status() }));
  ipc('adapter-install', async () => ({ status: await adapter.install() }));
  ipc('adapter-settings', ({ adapterPath = '', nodePath = '' }) => {
    for (const value of [adapterPath, nodePath]) if (typeof value !== 'string' || value.includes('\0') || value.length > 4096) throw new Error('Invalid adapter path');
    preferences.upsert({ id: 'settings', adapterPath, nodePath }); return { status: adapter.status() };
  });
  ipc('attach', input => ensureManager().attach(input));
  ipc('browser', input => ensureManager().browser(input));
  ipc('list', () => ({ sessions: manager?.list() || [], breakpoints: store.breakpoints.read(), watches: store.watches.read() }));
  ipc('start', ({ configurationId, projectId, projectName }) => ensureManager().start(configurationId, projectId, projectName));
  ipc('stop', async ({ sessionId, force }) => ({ run: await ensureManager().stop(sessionId, force) }));
  ipc('restart', ({ sessionId }) => ensureManager().restart(sessionId));
  ipc('action', async ({ sessionId, command, threadId }) => ({ result: await ensureManager().action(sessionId, command, threadId) }));
  const queries = { threads: ['threads'], frames: ['stackTrace', 'threadId'], scopes: ['scopes', 'frameId'], variables: ['variables', 'variablesReference'], evaluate: ['evaluate', 'expression'] };
  for (const [name, [command, field]] of Object.entries(queries)) ipc(name, async p => {
    const args = {};
    if (field) args[field] = p[field];
    if (name === 'frames') { args.startFrame = 0; args.levels = 100; }
    if (name === 'variables') { args.start = Math.max(0, Number(p.start) || 0); args.count = 100; }
    if (name === 'evaluate') { args.frameId = p.frameId; args.context = p.context === 'watch' ? 'watch' : 'repl'; if (typeof args.expression !== 'string' || args.expression.length > 4096) throw new Error('Invalid expression'); }
    return { result: await ensureManager().request(p.sessionId, command, args, p.generation) };
  });
  ipc('exceptions', async ({ sessionId, enabled }) => ({ result: await ensureManager().exceptionFilters(sessionId, enabled) }));
  ipc('source', async ({ sessionId, path }) => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) throw new Error('Invalid source path');
    const s = ensureManager().get(sessionId);
    await manager.verifySession(sessionId);
    const source = await prerequisite().sourceContext(s.host);
    return { file: { ...source, path, projectId: s.projectId } };
  });
  ipc('breakpoint-save', async ({ breakpoint }) => {
    const saved = store.saveBreakpoint(breakpoint || {}); await manager?.sync(); changed(); return { breakpoint: saved };
  });
  ipc('breakpoint-remove', async ({ id }) => { store.breakpoints.remove(id); await manager?.sync(); changed(); return {}; });
  ipc('breakpoint-bulk', async ({ projectId, host, action }) => {
    if (!['enable', 'disable', 'remove'].includes(action)) throw new Error('Invalid breakpoint action');
    const list = store.breakpoints.read();
    const matches = b => b.projectId === String(projectId || '') && b.host === String(host || '__local__');
    store.breakpoints.write(action === 'remove' ? list.filter(b => !matches(b)) : list.map(b => matches(b) ? { ...b, enabled: action === 'enable' } : b));
    await manager?.sync(); changed(); return {};
  });
  ipc('watch-save', ({ watch }) => { const saved = store.saveWatch(watch || {}); changed(); return { watch: saved }; });
  ipc('watch-remove', ({ id }) => { store.watches.remove(id); changed(); return {}; });
  const debuggerService = {
    hasRun: id => manager?.hasRun(id),
    stopRun: (id, force, options) => manager.stop(manager.sessionForRun(id).id, force, options),
    restartRun: async (id, options) => (await manager.restart(manager.sessionForRun(id).id, options)).run
  };
  registerService('jsdebug', debuggerService);
  registerDebugger?.(debuggerService);
  registerActivation(active => { enabled = active; if (!active) return manager?.shutdown(); });
  const timer = setInterval(async () => {
    if (!enabled || monitoring || !manager) return;
    monitoring = true;
    try { prerequisite(); await manager.monitor(); }
    catch (_) { await manager.shutdown(); }
    finally { monitoring = false; }
  }, 1500);
  timer.unref();
  registerShutdown(async () => { clearInterval(timer); await manager?.shutdown(); await adapter.stop(); });
};
