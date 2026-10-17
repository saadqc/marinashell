const fs = require('fs'); const path = require('path'); const net = require('net'); const { randomUUID } = require('crypto');
const os = require('os');
const { DapClient } = require('../../main/services/dapClient');
const { quote, normalizeJavaScriptDebug } = require('../run-configurations/configuration');
const { ended } = require('../run-configurations/manager');
const bootstrap = fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const connect = port => new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); }); socket.once('error', reject); });
function createJsDebugManager({ runs, store, adapter, openTransport, changed = () => {} }) {
  const sessions = new Map(); const launching = new Set(); const launches = new Set();
  const active = s => !['ended', 'failed'].includes(s.state);
  const publish = s => ({ id: s.id, runId: s.run?.id || '', configurationId: s.configurationId || '', projectId: s.projectId, projectName: s.projectName, name: s.name, host: s.host,
    state: s.state, generation: s.generation, threadId: s.threadId, reason: s.reason || '', error: s.error || '', sourceAliases: Object.fromEntries(s.aliases), verification: Object.fromEntries(s.verification), capabilities: s.capabilities || {}, exceptionsEnabled: s.exceptionsEnabled || false, notes: [], interpreter: s.endpoint?.interpreter || '', cwd: s.endpoint?.cwd || '' });
  const get = id => { const s = sessions.get(id); if (!s) throw new Error('JavaScript debug session not found'); return s; };
  const update = (s, state, error = '') => { s.state = state; s.error = error; changed(); };
  function make(input) { const s = { ...input, id: randomUUID(), state: 'preflight', generation: 0, aliases: new Map(), verification: new Map(), clientBreakpoints: new Map(), clients: new Set(), readyClients: new Set(), clientPaths: new Map(), forwards: new Set(), sockets: new Set() }; sessions.set(s.id, s); changed(); return s; }
  async function canonical(s, file) {
    if (s.aliases.has(file)) return s.aliases.get(file);
    let resolved = file;
    if (s.host === '__local__') resolved = await fs.promises.realpath(file).catch(() => file);
    else if (s.endpoint?.interpreter) {
      resolved = (await runs.command(s.host, `${quote(s.endpoint.interpreter)} -e ${quote('console.log(require("fs").realpathSync(process.argv[1]))')} ${quote(file)}`)).trim();
    }
    s.aliases.set(file, resolved); return resolved;
  }
  async function forward(s, remotePort) {
    if (s.host === '__local__') return remotePort;
    const server = net.createServer(async socket => {
      s.sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => s.sockets.delete(socket));
      try { const stream = await openTransport(s.host, remotePort); s.sockets.add(stream); stream.on('error', () => socket.destroy()); stream.once('close', () => { s.sockets.delete(stream); socket.destroy(); }); socket.once('close', () => stream.destroy()); socket.pipe(stream).pipe(socket); }
      catch (error) { socket.destroy(); s.error = error.message; changed(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); s.forwards.add(server); return server.address().port;
  }
  const points = s => store.breakpoints.read().filter(b => b.enabled && b.host === s.host && b.projectId === s.projectId);
  async function syncClient(s, client) {
    if (client.closed || !s.readyClients.has(client) || !active(s) || s.state === 'stopping') return;
    const entries = points(s); const sent = s.clientPaths.get(client) || new Set();
    for (const file of new Set([...sent, ...entries.map(b => b.path)])) {
      if (client.closed || !active(s) || s.state === 'stopping') return;
      const matches = entries.filter(b => b.path === file);
      try {
        const sourcePath = await canonical(s, file);
        const result = await client.request('setBreakpoints', { source: { path: sourcePath }, breakpoints: matches.map(b => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}) })) });
        const ids = s.clientBreakpoints.get(client) || new Map(); s.clientBreakpoints.set(client, ids);
        matches.forEach((b, i) => { const value = result.breakpoints?.[i] || {}; if (value.id != null) ids.set(value.id, b.id); s.verification.set(b.id, { verified: Boolean(value.verified), line: value.line || b.line, message: value.message || '' }); });
      } catch (error) { if (!client.closed && active(s) && s.state !== 'stopping') throw error; }
    }
    s.clientPaths.set(client, new Set(entries.map(b => b.path))); changed();
  }
  async function configure(s, launch, child = false) {
    if (s.cancelled) throw new Error('Debug session stopped');
    const port = await adapter.start(); if (s.cancelled) throw new Error('Debug session stopped'); const stream = await connect(port);
    const client = new DapClient(stream, { onRequest: async message => {
      if (message.command !== 'startDebugging' || typeof message.arguments?.configuration?.__pendingTargetId !== 'string') throw new Error('Unsupported JavaScript adapter reverse request');
      const configuration = message.arguments.configuration;
      if (!['pwa-node', 'pwa-chrome', 'pwa-msedge', 'node', 'chrome', 'msedge'].includes(configuration.type)) throw new Error('Unsupported debugger target');
      await configure(s, { ...configuration, request: message.arguments.request || 'attach' }, true); return {};
    } });
    s.clients.add(client); if (!s.client) s.client = client;
    client.on('disconnected', error => {
      s.clients.delete(client);
      s.readyClients.delete(client);
      if (active(s) && s.state !== 'stopping' && client === s.client) { update(s, 'disconnected', error.message); stop(s.id).catch(failure => update(s, 'disconnected', failure.message)); }
    });
    let initializeResolve; const initialized = new Promise(resolve => { initializeResolve = resolve; });
    client.on('event', event => {
      if (event.event === 'initialized') initializeResolve();
      else if (event.event === 'stopped') { s.activeClient = client; s.threadId = event.body?.threadId; s.generation++; s.reason = event.body?.reason || 'breakpoint'; update(s, 'paused'); }
      else if (event.event === 'continued' && s.activeClient === client) { s.generation++; update(s, 'running'); }
      else if (event.event === 'breakpoint') { const value = event.body?.breakpoint; const id = s.clientBreakpoints.get(client)?.get(value?.id); if (id) s.verification.set(id, { verified: value.verified, line: value.line, message: value.message || '' }); changed(); }
      else if (event.event === 'terminated' && s.activeClient === client) { s.activeClient = null; if (!s.run) update(s, 'ended'); else if (active(s) && s.state !== 'stopping') update(s, 'running'); }
    });
    const capabilities = await client.request('initialize', { clientID: 'marinashell', adapterID: 'js-debug', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariablePaging: true, supportsRunInTerminalRequest: false, supportsStartDebuggingRequest: true });
    s.capabilities = capabilities;
    const attaching = client.request(launch.request || 'attach', launch, 30000); attaching.catch(() => {});
    // js-debug defers attach completion until each target gets its own DAP connection.
    await Promise.race([initialized, attaching]);
    if (s.cancelled) throw new Error('Debug session stopped');
    s.readyClients.add(client);
    await syncClient(s, client);
    await client.request('setExceptionBreakpoints', { filters: [] });
    await client.request('configurationDone'); await attaching;
    if (child && s.state !== 'paused') s.activeClient = client;
    if (!child && s.state !== 'paused') update(s, 'running');
    return client;
  }
  function start(...args) {
    const job = launch(...args); launches.add(job); job.then(() => launches.delete(job), () => launches.delete(job)); return job;
  }
  async function launch(configurationId, projectId = '', projectName = '') {
    if (launching.has(configurationId)) throw new Error('JavaScript debug launch is already in progress');
    const config = runs.configs.assertRunnable?.(configurationId) || runs.configs.read().find(c => c.id === configurationId);
    if (!config || config.type !== 'javascript' || config.tmux) throw new Error('Select a JavaScript configuration without tmux');
    if (!adapter.status().installed) throw new Error('Install the JavaScript debug adapter from JSDebug → Debugger setup / Attach');
    launching.add(configurationId); const s = make({ configurationId, projectId, projectName, name: config.name, host: config.host || '__local__' });
    try {
      s.run = await runs.start(configurationId, projectId, projectName, { debug: { type: 'javascript', bootstrap } });
      const endpointFile = `${s.run.home}/.marinashell/runs/${s.run.id}/debug-endpoint.json`;
      for (let i = 0; i < 150; i++) {
        if (s.cancelled) throw new Error('Debug launch cancelled');
        const text = await runs.command(s.host, `head -c 4096 ${quote(endpointFile)} 2>/dev/null || true`);
        if (text.trim()) { s.endpoint = JSON.parse(text); break; }
        if (i % 10 === 0 && ended(await runs.status(s.run.id))) throw new Error('Node exited before debugger attachment; open the run output');
        await delay(100);
      }
      if (!Number.isInteger(s.endpoint?.port) || s.endpoint.host !== '127.0.0.1' || s.endpoint.port < 1 || s.endpoint.port > 65535) throw new Error('Timed out waiting for the owned Node inspector');
      const port = await forward(s, s.endpoint.port); update(s, 'connecting');
      await configure(s, { type: 'pwa-node', request: 'attach', name: config.name, address: '127.0.0.1', port, cwd: s.endpoint.cwd, restart: false, pauseForSourceMap: true, runtimeSourcemapPausePatterns: [`${s.endpoint.cwd}/**`], outFiles: [`${s.endpoint.cwd}/**/*.js`, `${s.endpoint.cwd}/**/*.cjs`, `${s.endpoint.cwd}/**/*.mjs`], resolveSourceMapLocations: [`${s.endpoint.cwd}/**`, '!**/node_modules/**'], skipFiles: ['<node_internals>/**'], ...normalizeJavaScriptDebug(config.javascriptDebug) });
      return { session: publish(s), run: s.run };
    } catch (error) { await stop(s.id).catch(() => {}); update(s, 'failed', error.message); throw error; }
    finally { launching.delete(configurationId); }
  }
  async function attach(input) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error('Inspector port must be between 1 and 65535');
    const s = make({ host: input.host || '__local__', projectId: input.projectId || '', projectName: input.projectName || '', name: input.name || 'Attached Node.js', attachInput: input });
    try { const port = await forward(s, input.port); await configure(s, { type: 'pwa-node', request: 'attach', address: '127.0.0.1', port, restart: false, cwd: input.cwd || process.cwd(), ...normalizeJavaScriptDebug(input.sourceMaps), autoAttachChildProcesses: false }); return { session: publish(s) }; }
    catch (error) { await stop(s.id).catch(() => {}); update(s, 'failed', error.message); throw error; }
  }
  async function browser(input) {
    if (!['chrome', 'edge'].includes(input.browser)) throw new Error('Choose Chrome or Edge');
    if (typeof input.webRoot !== 'string' || !path.isAbsolute(input.webRoot)) throw new Error('Choose an absolute web source directory');
    if (input.runtimeExecutable && (typeof input.runtimeExecutable !== 'string' || input.runtimeExecutable.includes('\0'))) throw new Error('Invalid browser executable path');
    const attaching = input.mode === 'attach';
    if (attaching && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) throw new Error('Choose a browser loopback debugging port');
    if (!attaching && !['http:', 'https:'].includes(new URL(input.url).protocol)) throw new Error('Enter an HTTP or HTTPS application URL');
    const s = make({ host: attaching ? input.host || '__local__' : '__local__', projectId: input.projectId || '', projectName: input.projectName || '', name: `${attaching ? 'Attached' : 'Browser'} ${input.browser}`, ownedBrowser: !attaching, browserInput: !attaching ? input : null });
    try {
      const config = { type: input.browser === 'edge' ? 'pwa-msedge' : 'pwa-chrome', request: attaching ? 'attach' : 'launch', webRoot: input.webRoot, sourceMaps: true, pauseForSourceMap: true, restart: false };
      if (attaching) { config.address = '127.0.0.1'; config.port = await forward(s, input.port); if (input.url) config.urlFilter = input.url; }
      else {
        s.profileDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'marina-browser-'));
        Object.assign(config, { url: input.url, runtimeExecutable: input.runtimeExecutable || 'stable', userDataDir: s.profileDirectory, runtimeArgs: input.headless ? ['--headless=new'] : [], port: 0 });
      }
      await configure(s, config); return { session: publish(s) };
    } catch (error) { await stop(s.id).catch(() => {}); update(s, 'failed', error.message); throw error; }
  }
  async function stop(id, force = false, options = {}) {
    const s = get(id); if (s.stopping) return s.stopping; s.cancelled = true; s.generation++; update(s, 'stopping');
    s.stopping = (async () => {
      for (const client of s.clients) if (!client.closed) { await client.request('disconnect', { terminateDebuggee: Boolean(s.ownedBrowser) }, 3000).catch(() => {}); client.close(); }
      for (const socket of s.sockets) socket.destroy(); for (const server of s.forwards) server.close();
      if (s.run) {
        let run = await runs.status(s.run.id); if (!ended(run)) run = await runs.stop(s.run.id, force, options);
        for (let i = 0; i < 60 && !ended(run); i++) { await delay(100); run = await runs.status(s.run.id); }
        if (!ended(run)) throw new Error('Process status is uncertain. Reconnect and Stop before restarting.'); s.run = run;
      }
      if (s.profileDirectory) { await fs.promises.rm(s.profileDirectory, { recursive: true, force: true }).catch(() => {}); s.profileDirectory = null; }
      update(s, 'ended'); return s.run || null;
    })();
    try { return await s.stopping; } catch (error) { update(s, 'disconnected', error.message); throw error; } finally { s.stopping = null; }
  }
  async function request(id, command, args = {}, generation) {
    const s = get(id); const client = s.activeClient || s.client; const version = s.generation;
    if (!client || client.closed || generation != null && generation !== version || !['threads', 'pause'].includes(command) && s.state !== 'paused') throw new Error('The selected debug frame is no longer paused');
    const result = await client.request(command, args);
    if (version !== s.generation) throw new Error('Debugger resumed; discard stale values'); return result;
  }
  async function action(id, command, threadId) {
    if (!['continue', 'pause', 'next', 'stepIn', 'stepOut'].includes(command)) throw new Error('Invalid debug action');
    const s = get(id); const client = s.activeClient || s.client;
    if (!client || client.closed || command !== 'pause' && s.state !== 'paused') throw new Error('Debugger is not paused');
    const target = threadId || s.threadId || (await client.request('threads')).threads?.[0]?.id;
    if (command !== 'pause') { s.generation++; update(s, 'running'); }
    return client.request(command, { threadId: target });
  }
  async function sync() { for (const s of sessions.values()) if (active(s)) for (const client of s.clients) await syncClient(s, client); }
  async function restart(id, options = {}) { const s = get(id); if (s.browserInput) { await stop(id); return browser(s.browserInput); } if (!s.run) throw new Error('Disconnect and attach again to restart an external session'); runs.configs.assertRunnable?.(s.configurationId); await stop(id, false, options); return start(s.configurationId, s.projectId, s.projectName); }
  async function monitor() { for (const s of sessions.values()) if (s.run && active(s) && s.state !== 'stopping' && ended(await runs.status(s.run.id))) await stop(s.id); }
  async function shutdown() {
    for (const s of sessions.values()) if (active(s)) s.cancelled = true;
    await Promise.allSettled([...sessions.values()].filter(s => active(s) || s.clients.size || s.forwards.size).map(s => stop(s.id, true)));
    await Promise.allSettled([...launches]);
    await Promise.allSettled([...sessions.values()].filter(s => active(s) && s.run).map(s => stop(s.id, true)));
    await adapter.stop();
  }
  async function exceptionFilters(id, enabled) { const s = get(id); for (const client of s.readyClients) if (!client.closed) await client.request('setExceptionBreakpoints', { filters: enabled ? ['uncaught'] : [] }); s.exceptionsEnabled = Boolean(enabled); changed(); return {}; }
  return { start, attach, browser, stop, restart, request, action, sync, monitor, shutdown, exceptionFilters, get, list: () => [...sessions.values()].map(publish), verifySession: id => { const s = get(id); return s.run ? runs.verifyHost(s.run) : Promise.resolve(); }, hasRun: id => [...sessions.values()].some(s => s.run?.id === id), sessionForRun: id => [...sessions.values()].find(s => s.run?.id === id) };
}
module.exports = { createJsDebugManager };
