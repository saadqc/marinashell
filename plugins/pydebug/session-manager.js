const fs = require('fs');
const path = require('path');
const net = require('net');
const { randomUUID } = require('crypto');
const { DapClient } = require('./dap-client');
const { quote } = require('../run-configurations/configuration');
const { ended } = require('../run-configurations/manager');
const bootstrap = fs.readFileSync(path.join(__dirname, 'bootstrap.py'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const active = session => !['ended', 'failed'].includes(session.state);

function createDebugManager({ runs, store, openTransport, changed = () => {}, root }) {
  const sessions = new Map(); const starting = new Set(); const launches = new Set();
  const publicSession = s => ({ id: s.id, runId: s.run?.id || '', configurationId: s.configurationId,
    projectId: s.projectId, projectName: s.projectName, name: s.name, host: s.host,
    state: s.state, error: s.error || '', generation: s.generation, threadId: s.threadId,
    reason: s.reason || '', conditionError: s.conditionError || '', exceptionsEnabled: Boolean(s.exceptionsEnabled), notes: s.run?.debugNotes || [], capabilities: s.capabilities || {},
    verification: Object.fromEntries(s.verification || []), sourceAliases: Object.fromEntries(s.paths || []), interpreter: s.endpoint?.interpreter || '', cwd: s.endpoint?.cwd || '' });
  function get(id) { const s = sessions.get(id); if (!s) throw new Error('Debug session not found'); return s; }
  function invalidate(s) { s.generation++; s.threadId = null; s.reason = ''; }
  function state(s, value, error = '') { s.state = value; s.error = error; changed(); }
  async function connectLocal(port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); });
      socket.once('error', reject); socket.setTimeout(10000, () => socket.destroy(new Error('Debugger connection timed out')));
    });
  }
  async function canonical(s, file) {
    await runs.verifyHost(s.run);
    if (s.paths.has(file)) return s.paths.get(file);
    const code = `import os; print(os.path.realpath(${JSON.stringify(file)}))`;
    const resolved = (await runs.command(s.host, `${quote(s.endpoint.interpreter)} -c ${quote(code)}`, { timeoutMs: 10000 })).trim();
    if (!resolved.startsWith('/')) throw new Error('Could not resolve source path on execution host');
    s.paths.set(file, resolved); return resolved;
  }
  async function syncSession(s, additionalPaths = []) {
    if (!s.client || !s.initialized || !active(s) || s.state === 'stopping') return;
    s.conditionError = '';
    const points = store.breakpoints.read().filter(b => b.host === s.host && b.projectId === s.projectId);
    const paths = new Set([...s.sentPaths, ...points.map(b => b.path), ...additionalPaths]);
    const grouped = new Map();
    for (const file of paths) {
      const resolved = await canonical(s, file);
      if (!grouped.has(resolved)) grouped.set(resolved, []);
      grouped.get(resolved).push(...points.filter(b => b.path === file && b.enabled));
    }
    for (const [file, entries] of grouped) {
      const supported = entries.filter(b => !b.condition || s.capabilities.supportsConditionalBreakpoints);
      for (const b of entries.filter(b => b.condition && !s.capabilities.supportsConditionalBreakpoints)) s.verification.set(b.id, { verified: false, message: 'Debugger does not support conditional breakpoints' });
      const response = await s.client.request('setBreakpoints', { source: { path: file }, breakpoints: supported.map(b => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}) })) });
      supported.forEach((b, i) => { const result = response.breakpoints?.[i] || {}; s.verification.set(b.id, { verified: Boolean(result.verified), line: result.line || b.line, message: result.message || '' }); if (result.id != null) s.breakpointIds.set(result.id, b.id); });
    }
    s.sentPaths = new Set(points.map(b => b.path)); changed();
  }
  async function sync() {
    await Promise.all([...sessions.values()].filter(active).map(s => {
      s.sync = (s.sync || Promise.resolve()).catch(() => {}).then(() => syncSession(s));
      return s.sync;
    }));
  }
  async function onEvent(s, message) {
    if (!active(s)) return;
    const body = message.body || {};
    if (message.event === 'stopped') {
      invalidate(s); s.threadId = body.threadId; s.reason = body.reason || 'breakpoint'; state(s, 'paused');
    } else if (message.event === 'continued') { invalidate(s); s.conditionError = ''; state(s, 'running'); }
    else if (message.event === 'breakpoint' && body.breakpoint) {
      const b = body.breakpoint; const id = s.breakpointIds.get(b.id);
      if (id) { s.verification.set(id, { verified: Boolean(b.verified), line: b.line, message: b.message || '' }); changed(); }
    } else if (message.event === 'output' && ['stderr', 'important'].includes(body.category)) {
      const output = String(body.output || '').slice(-2000);
      if (output.includes('conditional breakpoint')) s.conditionError = output;
      else s.error = output;
      changed();
    }
    else if (message.event === 'terminated' || message.event === 'exited') {
      if (s.state === 'stopping') return;
      await stop(s.id).catch(error => state(s, 'disconnected', error.message));
    }
  }
  async function launch(configurationId, projectId = '', projectName = '') {
    if (starting.has(configurationId)) throw new Error('Debugger is already starting');
    starting.add(configurationId);
    const config = runs.configs.read().find(c => c.id === configurationId);
    if (!config) { starting.delete(configurationId); throw new Error('Save the Python configuration before debugging'); }
    const s = { id: randomUUID(), configurationId, projectId, projectName, host: config.host || '__local__', name: config.name,
      generation: 0, state: 'preflight', verification: new Map(), breakpointIds: new Map(), paths: new Map(), sentPaths: new Set() };
    sessions.set(s.id, s); changed();
    try {
      s.run = await runs.start(configurationId, projectId, projectName, { debug: { bootstrap } });
      if (s.cancelled) throw new Error('Debug launch cancelled');
      if (ended(s.run)) throw new Error('Python exited before debugger attachment; open the configuration output');
      state(s, 'connecting');
      const endpointFile = `${s.run.home}/.marinashell/runs/${s.run.id}/debug-endpoint.json`;
      for (let i = 0; i < 150; i++) {
        if (s.cancelled) throw new Error('Debug launch cancelled');
        const text = await runs.command(s.host, `head -c 2048 ${quote(endpointFile)} 2>/dev/null || true`, { timeoutMs: 5000 });
        if (text.trim()) { s.endpoint = JSON.parse(text); break; }
        if (i % 10 === 0 && ended(await runs.status(s.run.id))) throw new Error('Python exited before publishing its debugger endpoint; open the configuration output');
        await delay(100);
      }
      if (!Number.isInteger(s.endpoint?.port) || s.endpoint.port < 1 || s.endpoint.host !== '127.0.0.1') throw new Error('Timed out waiting for the owned debugger endpoint');
      const transport = s.host === '__local__' ? await connectLocal(s.endpoint.port) : await openTransport(s.host, s.endpoint.port);
      if (s.cancelled) { transport.destroy(); throw new Error('Debug launch cancelled'); }
      transport.setTimeout?.(0);
      s.client = new DapClient(transport);
      s.client.on('event', event => { onEvent(s, event).catch(error => { s.error = error.message; changed(); }); });
      s.client.on('disconnected', error => {
        if (active(s) && s.state !== 'stopping') {
          invalidate(s); state(s, 'disconnected', error.message);
          stop(s.id).catch(failure => state(s, 'disconnected', failure.message));
        }
      });
      s.capabilities = await s.client.request('initialize', { clientID: 'marinashell', adapterID: 'python', linesStartAt1: true,
        columnsStartAt1: true, pathFormat: 'path', supportsVariablePaging: true, supportsRunInTerminalRequest: false });
      const initialized = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Debugger initialization timed out')), 15000);
        s.client.on('event', message => { if (message.event === 'initialized') { clearTimeout(timer); resolve(); } });
      });
      const attaching = s.client.request('attach', { justMyCode: true, subProcess: false }, 30000);
      attaching.catch(() => {});
      state(s, 'configuring'); await initialized; s.initialized = true;
      await syncSession(s);
      await s.client.request('setExceptionBreakpoints', { filters: [] });
      await s.client.request('configurationDone'); await attaching;
      if (s.state === 'configuring') state(s, 'running');
      return { session: publicSession(s), run: s.run };
    } catch (error) {
      let failure = error.message;
      if (s.run) await stop(s.id).catch(error => { failure += `; cleanup: ${error.message}`; });
      state(s, s.state === 'disconnected' ? 'disconnected' : 'failed', failure);
      throw new Error(failure);
    } finally { starting.delete(configurationId); changed(); }
  }
  function start(...args) {
    const pending = launch(...args); launches.add(pending);
    pending.finally(() => launches.delete(pending)).catch(() => {});
    return pending;
  }
  async function stop(id, force = false) {
    const s = get(id); s.cancelled = true;
    if (s.stopPromise && !force) return s.stopPromise;
    const operation = (async () => {
      invalidate(s); state(s, 'stopping');
      if (s.client && !s.client.closed) {
        await s.client.request('disconnect', { terminateDebuggee: true }, 1500).catch(() => {});
        s.client.close();
      }
      if (!s.run) { state(s, 'ended'); return null; }
      let run = await runs.status(s.run.id);
      if (!ended(run)) run = await runs.stop(s.run.id, force);
      for (let i = 0; i < 60 && !ended(run); i++) { await delay(100); run = await runs.status(s.run.id); }
      if (!ended(run)) throw new Error(run.status === 'unknown' ? 'SSH/process status unknown; reconnect and Stop before restarting' : 'Process is still stopping; press Stop again to force termination');
      s.run = run; state(s, 'ended'); return run;
    })();
    s.stopPromise = operation;
    try { return await operation; } catch (error) { state(s, 'disconnected', error.message); throw error; }
    finally { if (s.stopPromise === operation) s.stopPromise = null; }
  }
  async function restart(id) { const s = get(id); await stop(id); return start(s.configurationId, s.projectId, s.projectName); }
  async function request(id, command, args = {}, generation) {
    const s = get(id); const version = s.generation;
    const runningAllowed = ['threads', 'pause'].includes(command);
    if (!s.client || (!runningAllowed && s.state !== 'paused') || (generation != null && generation !== version)) throw new Error('The selected debug frame is no longer paused');
    const result = await s.client.request(command, args);
    if (!['pause', 'continue', 'next', 'stepIn', 'stepOut'].includes(command) && version !== s.generation) throw new Error('Debugger resumed; discard stale values');
    return result;
  }
  async function action(id, command, threadId) {
    if (!['continue', 'pause', 'next', 'stepIn', 'stepOut'].includes(command)) throw new Error('Invalid debug action');
    const s = get(id);
    if (command === 'pause') return request(id, command, { threadId: threadId || s.threadId || (await request(id, 'threads')).threads?.[0]?.id });
    if (!s.client || s.state !== 'paused') throw new Error('Debugger is not paused');
    const target = threadId || s.threadId;
    invalidate(s); state(s, 'running');
    try { return await s.client.request(command, { threadId: target }); }
    catch (error) { s.threadId = target; state(s, 'paused', error.message); throw error; }
  }
  async function exceptionFilters(id, enabled) {
    const s = get(id); if (!s.initialized || !s.client) throw new Error('Debugger is not connected');
    const filter = s.capabilities.exceptionBreakpointFilters?.find(f => f.filter === 'uncaught');
    if (enabled && !filter) throw new Error('Debugger does not support uncaught exception breakpoints');
    const result = await s.client.request('setExceptionBreakpoints', { filters: enabled ? [filter.filter] : [] });
    s.exceptionsEnabled = Boolean(enabled); changed(); return result;
  }
  async function shutdown() {
    for (const s of sessions.values()) if (active(s)) s.cancelled = true;
    await Promise.allSettled([...sessions.values()].filter(active).map(s => stop(s.id, true)));
    await Promise.allSettled([...launches]);
    await Promise.allSettled([...sessions.values()].filter(s => s.run && active(s)).map(s => stop(s.id, true)));
  }
  async function monitor() {
    for (const s of sessions.values()) {
      if (!s.run || !active(s) || s.state === 'stopping') continue;
      const run = await runs.status(s.run.id); s.run = run;
      if (ended(run)) { invalidate(s); state(s, 'ended'); s.client?.close(); }
    }
  }
  return { start, stop, restart, request, action, exceptionFilters, sync, shutdown, monitor, canonical,
    verifySession: id => runs.verifyHost(get(id).run),
    get, list: () => [...sessions.values()].map(publicSession), hasRun: id => [...sessions.values()].some(s => s.run?.id === id),
    sessionForRun: id => [...sessions.values()].find(s => s.run?.id === id) };
}
module.exports = { createDebugManager };
