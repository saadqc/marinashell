import { button, modal, showError } from '../../renderer/components/dialog.js';
import { setDebugProvider, notifyDebugViews, registerRunAction } from '../../renderer/services/debugIntegration.js';

let activated = false;
export default function activate({ api, state, sessionTabs, openView, registerView, registerCommand }) {
  if (activated) return; activated = true;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./style.css', import.meta.url).href; document.head.append(style);
  let data = { sessions: [], breakpoints: [], watches: [] }; let selectedId = ''; let currentDoc = null; let location = null;
  let frames = []; let scopes = []; let threads = []; let frameId = null; let threadId = null; let epoch = 0; let inspected = '';
  let enabled = true; let prerequisites = ''; let busy = false; let dirty = false; let removeRunAction; let sourceError = '';
  const consoleLogs = new Map();
  const panels = new Map(); const seenStops = new Map(); const variableCache = new Map(); const watchResults = new Map();
  const mappedBreakpoints = new Map(); const changedFiles = new Set();
  const canonicalPath = file => selected()?.sourceAliases?.[file] || file;
  const fileKey = doc => `${doc.host}\0${doc.projectId || ''}\0${canonicalPath(doc.path)}`;
  const selected = () => data.sessions.find(s => s.id === selectedId);
  const project = () => state.appState.tabGroups?.find(p => p.id === state.tabs.get(state.activeTabId)?.groupId);
  const scope = () => ({ projectId: selected()?.projectId || currentDoc?.projectId || project()?.id || '', host: selected()?.host || currentDoc?.host || state.tabs.get(state.activeTabId)?.host || '__local__' });
  const pointsFor = doc => data.breakpoints.filter(b => b.host === (doc.host || '__local__') && b.projectId === (doc.projectId || '') && canonicalPath(b.path) === canonicalPath(doc.path));
  const el = (tag, text, cls = '') => { const node = document.createElement(tag); node.textContent = text || ''; node.className = cls; return node; };
  const safe = fn => async (...args) => { try { await fn(...args); } catch (error) { showError(error); } };
  async function call(name, payload = {}) { const result = await api.invoke(`plugin:pydebug:${name}`, payload); if (!result?.ok) throw new Error(result?.error || 'PyDebug request failed'); return result; }
  async function query(name, payload = {}) {
    const s = selected(); if (!s) throw new Error('Select a debug session');
    return (await call(name, { sessionId: s.id, generation: s.generation, ...payload })).result;
  }
  function clearInspection() { epoch++; inspected = ''; frames = []; scopes = []; threads = []; frameId = null; location = null; sourceError = ''; variableCache.clear(); watchResults.clear(); }
  async function openSource(file, line, s = selected()) {
    if (!s) return;
    const response = await call('source', { sessionId: s.id, path: file });
    const tab = [...state.tabs.values()].find(t => t.groupId === s.projectId && (t.host === s.host || s.host === '__local__' && t.sessionType === 'local'));
    if (tab && tab.id !== state.activeTabId) sessionTabs.setActiveSessionTab(tab.id);
    sessionTabs.setWorkspaceMode?.('terminal');
    window.dispatchEvent(new CustomEvent('marinashell:editor:open', { detail: { ...response.file, line } }));
  }
  async function selectFrame(frame, navigate = true) {
    const s = selected(); if (!s || s.state !== 'paused') return;
    const token = ++epoch; frameId = frame.id; scopes = []; sourceError = ''; variableCache.clear(); watchResults.clear();
    location = frame.source?.path ? { sessionId: s.id, projectId: s.projectId, host: s.host, path: frame.source.path, line: frame.line } : null;
    notifyDebugViews(); renderPanels();
    const result = await query('scopes', { frameId });
    if (token !== epoch) return;
    scopes = result.scopes || [];
    if (navigate && frame.source?.path) {
      try { await openSource(frame.source.path, frame.line, s); }
      catch (error) { if (token === epoch) sourceError = `Cannot open source: ${error.message}`; }
    }
    if (token !== epoch) return;
    for (const watch of data.watches.filter(w => w.projectId === s.projectId)) {
      try { const value = await query('evaluate', { frameId: frame.id, expression: watch.expression, context: 'watch' }); if (token !== epoch) return; watchResults.set(watch.id, String(value.result).slice(0, 8000)); }
      catch (error) { if (token === epoch) watchResults.set(watch.id, error.message); }
    }
    if (token === epoch) { renderPanels(); notifyDebugViews(); }
  }
  async function inspect(navigate = true) {
    const s = selected(); if (!s || s.state !== 'paused') { clearInspection(); notifyDebugViews(); renderPanels(); return; }
    const key = `${s.id}:${s.generation}:${threadId || s.threadId}`;
    if (inspected === key) return;
    clearInspection(); inspected = key; threadId ||= s.threadId;
    const token = epoch; const threadResult = await query('threads'); const frameResult = await query('frames', { threadId: threadId || s.threadId });
    if (token !== epoch) return;
    threads = threadResult.threads || []; frames = frameResult.stackFrames || [];
    if (frames[0]) await selectFrame(frames[0], navigate); else renderPanels();
  }
  async function refresh() {
    if (!enabled) return;
    if (busy) { dirty = true; return; } busy = true;
    try {
      do {
        dirty = false; data = await call('list');
        for (const b of data.breakpoints) if (mappedBreakpoints.has(b.id)) b.line = mappedBreakpoints.get(b.id);
        const newlyPaused = data.sessions.filter(s => s.state === 'paused' && seenStops.get(s.id) !== s.generation);
        const wasPaused = selected()?.state === 'paused';
        if (!wasPaused && newlyPaused[0]) { selectedId = newlyPaused[0].id; threadId = null; }
        if (!selectedId && data.sessions.length) selectedId = data.sessions.at(-1).id;
        if (newlyPaused.some(s => s.id === selectedId)) threadId = selected().threadId;
        for (const s of newlyPaused) seenStops.set(s.id, s.generation);
        renderPanels(); notifyDebugViews();
        try { await inspect(Boolean(newlyPaused.some(s => s.id === selectedId))); }
        catch (error) { for (const [panel] of panels) panel.querySelector('.pd-error')?.replaceChildren(document.createTextNode(error.message)); }
      } while (dirty);
    } catch (error) { if (enabled) for (const [panel] of panels) panel.querySelector('.pd-error')?.replaceChildren(document.createTextNode(error.message)); }
    finally { busy = false; }
  }
  async function saveBreakpoint(point) { await call('breakpoint-save', { breakpoint: point }); await refresh(); }
  async function flushMapped(doc) {
    for (const b of data.breakpoints) {
      if (!mappedBreakpoints.has(b.id) || (doc && (b.host !== doc.host || b.projectId !== doc.projectId || canonicalPath(b.path) !== canonicalPath(doc.path)))) continue;
      await call('breakpoint-save', { breakpoint: { ...b, line: mappedBreakpoints.get(b.id) } }); mappedBreakpoints.delete(b.id);
    }
  }
  async function prepare(host, projectId) {
    await window.marinashellEditorDocuments?.saveForDebug(host, projectId);
    await flushMapped();
    for (const key of changedFiles) if (key.startsWith(`${host}\0${projectId || ''}\0`)) changedFiles.delete(key);
    clearInspection();
  }
  async function browseFile(host, target) {
    const result = await api.invoke('plugin:run-configurations:browse', { host, directory: target || '~', kind: 'file' });
    if (!result?.ok) throw new Error(result?.error || 'Cannot browse source files');
    if (host === '__local__') return result.path;
    return new Promise(resolve => {
      const picker = modal('Choose remote source file');
      const pathInput = el('input'); pathInput.value = result.directory; pathInput.setAttribute('aria-label', 'Remote directory');
      const entries = el('div');
      async function load(directory) {
        const listing = await api.invoke('plugin:run-configurations:browse', { host, directory });
        if (!listing?.ok) throw new Error(listing?.error || 'Cannot list directory');
        pathInput.value = listing.directory; entries.replaceChildren();
        entries.append(button('..', safe(() => load(listing.directory + '/..'))));
        for (const entry of listing.entries) entries.append(button((entry.directory ? '▸ ' : '') + entry.name, safe(async () => {
          const file = listing.directory.replace(/\/$/, '') + '/' + entry.name;
          if (entry.directory) await load(file); else { resolve(file); picker.close(); }
        })));
      }
      picker.body.append(pathInput, button('Go', safe(() => load(pathInput.value))), entries);
      picker.footer.append(button('Cancel', picker.close)); picker.dialog.addEventListener('close', () => resolve(''), { once: true });
      load(result.directory).catch(showError);
    });
  }
  function editBreakpoint(point = {}, doc = currentDoc, line = 1) {
    const dialog = modal(point.id ? 'Edit breakpoint' : 'Add breakpoint');
    const host = el('select'); host.setAttribute('aria-label', 'Breakpoint host');
    const hosts = new Set(['__local__', ...[...state.tabs.values()].map(t => t.host), ...data.breakpoints.map(b => b.host)]);
    for (const name of hosts) if (name) host.append(new Option(name === '__local__' ? 'Local' : name, name));
    host.value = point.host || doc?.host || scope().host;
    const group = el('select'); group.setAttribute('aria-label', 'Breakpoint project'); group.append(new Option('Ungrouped', ''));
    for (const p of state.appState.tabGroups || []) group.append(new Option(p.name, p.id));
    group.value = point.projectId || doc?.projectId || scope().projectId;
    const source = el('input'); source.value = point.path || doc?.path || ''; source.placeholder = '/absolute/path/to/source.py'; source.setAttribute('aria-label', 'Source path');
    const number = el('input'); number.type = 'number'; number.min = '1'; number.value = point.line || line; number.setAttribute('aria-label', 'Breakpoint line');
    const condition = el('input'); condition.value = point.condition || ''; condition.placeholder = 'Optional: case_id == "CASE-123"'; condition.setAttribute('aria-label', 'Python condition');
    const on = el('input'); on.type = 'checkbox'; on.checked = point.enabled !== false;
    const field = (label, input) => { const row = el('label', '', 'pd-field'); row.append(el('span', label), input); dialog.body.append(row); };
    field('Project', group); field('Host', host); field('Source file', source);
    dialog.body.append(button('Browse…', safe(async () => { const file = await browseFile(host.value, source.value || '~'); if (file) source.value = file; })));
    field('Line', number); field('Python condition (empty = always stop)', condition); field('Enabled', on);
    const error = el('p', '', 'pd-error'); dialog.body.append(error);
    dialog.footer.append(button('Cancel', dialog.close), button('Save breakpoint', async () => {
      try { await saveBreakpoint({ ...point, host: host.value, projectId: group.value, path: source.value, line: Number(number.value), condition: condition.value, enabled: on.checked }); dialog.close(); }
      catch (failure) { error.textContent = failure.message; }
    }));
  }
  function renderBreakpoints(container, settings) {
    const activeScope = settings.breakpointScope || scope();
    const projects = el('select'); projects.setAttribute('aria-label', 'Breakpoint project filter'); projects.append(new Option('Ungrouped', ''));
    for (const p of state.appState.tabGroups || []) projects.append(new Option(p.name, p.id)); projects.value = activeScope.projectId;
    const hosts = el('select'); hosts.setAttribute('aria-label', 'Breakpoint host filter');
    for (const host of new Set(['__local__', ...[...state.tabs.values()].map(t => t.host), ...data.breakpoints.map(b => b.host)])) if (host) hosts.append(new Option(host === '__local__' ? 'Local' : host, host)); hosts.value = activeScope.host;
    const filter = () => { settings.breakpointScope = { projectId: projects.value, host: hosts.value }; renderPanels(); };
    projects.addEventListener('change', filter); hosts.addEventListener('change', filter); container.append(projects, hosts);
    const list = data.breakpoints.filter(b => b.projectId === activeScope.projectId && b.host === activeScope.host);
    container.append(el('p', `${state.appState.tabGroups?.find(p => p.id === activeScope.projectId)?.name || 'Ungrouped'} · ${activeScope.host}`, 'pd-muted'));
    const actions = el('div', '', 'pd-actions'); actions.append(button('Add', () => editBreakpoint({}, { ...activeScope, path: currentDoc?.path || '' })));
    for (const [label, action] of [['Enable all', 'enable'], ['Disable all', 'disable'], ['Remove all', 'remove']]) actions.append(button(label, safe(async () => { await call('breakpoint-bulk', { ...activeScope, action }); await refresh(); })));
    container.append(actions);
    if (!list.length) container.append(el('p', 'No breakpoints in this project and host.', 'pd-muted'));
    for (const b of list) {
      const row = el('div', '', 'pd-breakpoint'); const check = el('input'); check.type = 'checkbox'; check.checked = b.enabled; check.setAttribute('aria-label', `Enable ${b.path}:${b.line}`);
      check.addEventListener('change', safe(() => saveBreakpoint({ ...b, enabled: check.checked })));
      const label = button(`${b.path.split('/').at(-1)}:${b.line}`, safe(() => {
        const s = data.sessions.find(s => s.projectId === b.projectId && s.host === b.host);
        if (s) return openSource(b.path, b.line, s);
        const tab = [...state.tabs.values()].find(t => (t.groupId || '') === b.projectId && t.host === b.host);
        if (tab) { sessionTabs.setActiveSessionTab(tab.id); window.dispatchEvent(new CustomEvent('marinashell:editor:open', { detail: { ...b, tabId: tab.id } })); }
      })); label.title = b.path;
      row.append(check, label, button('Edit', () => editBreakpoint(b)), button('Remove', safe(async () => { await call('breakpoint-remove', { id: b.id }); await refresh(); })));
      const verified = selected()?.verification[b.id];
      if (b.condition) row.append(el('code', b.condition, 'pd-condition'));
      if (verified && !verified.verified) row.append(el('small', verified.message || 'Unverified breakpoint', 'pd-muted'));
      if (verified?.verified && verified.line !== b.line) row.append(el('small', `Debugger bound to line ${verified.line}`, 'pd-muted'));
      container.append(row);
    }
  }
  function variableNode(item, s) {
    const row = el(item.variablesReference ? 'details' : 'div', '', 'pd-variable');
    const text = `${item.name}: ${String(item.value ?? '').slice(0, 2000)}`;
    if (!item.variablesReference) { row.textContent = text; return row; }
    const summary = el('summary', text); row.append(summary);
    row.addEventListener('toggle', safe(async () => {
      if (!row.open || row.dataset.loaded) return;
      row.dataset.loaded = '1'; const token = epoch; const generation = s.generation;
      async function load(start = 0) {
        const key = `${item.variablesReference}:${start}`;
        let values = variableCache.get(key);
        if (!values) { values = await query('variables', { variablesReference: item.variablesReference, start }); if (token !== epoch || selected()?.generation !== generation) return; variableCache.set(key, values); }
        for (const value of values.variables || []) row.append(variableNode(value, s));
        if (values.variables?.length === 100) row.append(button('Load more', safe(async event => { event.target.remove(); await load(start + 100); })));
      }
      try { await load(); } catch (error) { row.append(el('span', error.message, 'pd-error')); }
    }));
    return row;
  }
  function renderPanel(panel, settings) {
    panel.replaceChildren(); panel.classList.add('pd-panel');
    const s = selected(); const select = el('select'); select.setAttribute('aria-label', 'Debug session');
    select.append(new Option('Select debug session', ''));
    for (const item of data.sessions) select.append(new Option(`${item.projectName || 'Ungrouped'} / ${item.name} · ${item.state}`, item.id));
    select.value = selectedId; select.addEventListener('change', safe(async () => { selectedId = select.value; threadId = null; clearInspection(); await inspect(true); renderPanels(); }));
    panel.append(el('strong', 'PyDebug'), select);
    const info = el('p', prerequisites || (s ? `${s.state}${s.reason ? ' · ' + s.reason : ''}` : 'Set a breakpoint, then click Debug.'), 'pd-state'); panel.append(info);
    const error = el('p', [s?.error, s?.conditionError, sourceError].filter(Boolean).join('\n'), 'pd-error'); panel.append(error);
    if (prerequisites) panel.append(button('Open Settings', () => api.openSettings()));
    const toolbar = el('div', '', 'pd-actions');
    for (const [label, command] of [['Continue', 'continue'], ['Pause', 'pause'], ['Step over', 'next'], ['Step into', 'stepIn'], ['Step out', 'stepOut']]) {
      const control = button(label, safe(async () => { await call('action', { sessionId: s.id, command, threadId: threadId || s.threadId }); await refresh(); }));
      control.disabled = !s || (command === 'pause' ? s.state !== 'running' : s.state !== 'paused'); toolbar.append(control);
    }
    const restart = button('Restart Debug', safe(async () => {
      await prepare(s.host, s.projectId);
      const result = await call('restart', { sessionId: s.id }); selectedId = result.session.id; threadId = null; await refresh();
    })); restart.disabled = !s || ['preflight', 'connecting', 'configuring', 'stopping'].includes(s.state);
    const stop = button(s?.state === 'disconnected' ? 'Force Stop' : 'Stop', safe(async () => { await call('stop', { sessionId: s.id, force: s.state === 'disconnected' }); await refresh(); })); stop.disabled = !s || ['ended', 'failed'].includes(s.state);
    toolbar.append(restart, stop); panel.append(toolbar);
    if (s && ['running', 'paused'].includes(s.state)) {
      const exceptions = el('label', '', 'pd-exceptions'); const check = el('input'); check.type = 'checkbox'; check.checked = s.exceptionsEnabled;
      check.disabled = !s.capabilities.exceptionBreakpointFilters?.some(f => f.filter === 'uncaught');
      check.addEventListener('change', safe(async () => { await call('exceptions', { sessionId: s.id, enabled: check.checked }); await refresh(); })); exceptions.append(check, el('span', 'Break on uncaught exceptions')); panel.append(exceptions);
    }
    for (const note of s?.notes || []) panel.append(el('small', note, 'pd-muted'));
    const tabs = el('div', '', 'pd-tabs');
    for (const label of ['Inspect', 'Breakpoints', 'Watches', 'Console']) { const tab = button(label, () => { settings.tab = label; renderPanel(panel, settings); }); tab.classList.toggle('active', settings.tab === label); tabs.append(tab); }
    panel.append(tabs); const content = el('div', '', 'pd-content'); panel.append(content);
    if (settings.tab === 'Breakpoints') { renderBreakpoints(content, settings); return; }
    if (settings.tab === 'Inspect') {
      if (!s || s.state !== 'paused') { content.append(el('p', 'Variables and frames are available while paused.', 'pd-muted')); return; }
      const thread = el('select'); thread.setAttribute('aria-label', 'Debug thread'); for (const t of threads) thread.append(new Option(t.name, t.id)); thread.value = threadId || s.threadId;
      thread.addEventListener('change', safe(async () => { threadId = Number(thread.value); inspected = ''; await inspect(true); })); content.append(thread, el('h4', 'Call stack'));
      for (const frame of frames) { const row = button(`${frame.name} · ${frame.source?.name || frame.source?.path?.split('/').at(-1) || 'source unavailable'}:${frame.line}`, safe(() => selectFrame(frame))); row.className = 'pd-frame' + (frame.id === frameId ? ' active' : ''); content.append(row); }
      content.append(el('h4', 'Variables'));
      for (const scope of scopes) content.append(variableNode({ name: scope.name, value: '', variablesReference: scope.variablesReference }, s));
      const doc = window.marinashellEditorDocuments?.list().find(doc => doc.host === location?.host && doc.path === location?.path);
      if (doc?.dirty || location && changedFiles.has(fileKey(location))) content.append(el('p', 'Source differs from this running version. Save and Restart Debug to execute it.', 'pd-muted'));
    } else if (settings.tab === 'Watches') {
      const expression = el('input'); expression.placeholder = 'Python expression'; expression.setAttribute('aria-label', 'Watch expression');
      content.append(expression, button('Add watch', safe(async () => { await call('watch-save', { watch: { expression: expression.value, projectId: scope().projectId } }); await refresh(); if (frames.find(f => f.id === frameId)) await selectFrame(frames.find(f => f.id === frameId), false); })));
      for (const watch of data.watches.filter(w => w.projectId === scope().projectId)) { const row = el('div', '', 'pd-watch'); row.append(el('code', watch.expression), el('span', s?.state === 'paused' ? watchResults.get(watch.id) || 'Select a frame to evaluate' : 'Available while paused'), button('Remove', safe(async () => { await call('watch-remove', { id: watch.id }); await refresh(); }))); content.append(row); }
    } else {
      const log = el('pre', (consoleLogs.get(s?.id) || []).join('\n'), 'pd-console'); const input = el('input'); input.placeholder = 'Evaluate in selected frame'; input.setAttribute('aria-label', 'Debug expression'); input.disabled = s?.state !== 'paused' || frameId == null;
      const evaluate = safe(async () => { const id = s.id; const expression = input.value; const result = await query('evaluate', { frameId, expression }); consoleLogs.set(id, [...(consoleLogs.get(id) || []), `> ${expression}\n${String(result.result).slice(0, 8000)}`].slice(-50)); renderPanels(); });
      const submit = button('Evaluate', evaluate); submit.disabled = input.disabled;
      input.addEventListener('keydown', event => { if (event.key === 'Enter') evaluate(); }); content.append(log, input, submit);
    }
  }
  function renderPanels() { for (const [panel, settings] of panels) renderPanel(panel, settings); }
  const provider = {
    prepare,
    sameFile: (a, b) => canonicalPath(a) === canonicalPath(b),
    markers(doc) {
      const s = selected(); return { points: pointsFor(doc).map(b => ({ ...b, conditional: Boolean(b.condition), verified: s?.verification[b.id]?.verified, message: s?.verification[b.id]?.message })),
        line: s?.state === 'paused' && !doc.dirty && !changedFiles.has(fileKey(doc)) && location?.host === doc.host && location?.projectId === doc.projectId && canonicalPath(location?.path) === canonicalPath(doc.path) ? location.line : null };
    },
    toggle: safe(async (doc, line) => { const point = pointsFor(doc).find(b => b.line === line); if (point) await call('breakpoint-remove', { id: point.id }); else await saveBreakpoint({ host: doc.host, projectId: doc.projectId, path: doc.path, line }); await refresh(); }),
    edit(doc, line) { editBreakpoint(pointsFor(doc).find(b => b.line === line) || {}, doc, line); },
    map(doc, positions) { changedFiles.add(fileKey(doc)); for (const p of positions) { const b = data.breakpoints.find(b => b.id === p.id); if (b && b.line !== p.line) { b.line = p.line; mappedBreakpoints.set(b.id, p.line); } } renderPanels(); },
    document(doc) { currentDoc = doc; },
    mountPanel(panel, initialTab = 'Inspect') { panels.set(panel, { tab: initialTab }); renderPanel(panel, panels.get(panel)); return () => panels.delete(panel); }
  };
  async function configure() {
    const plugins = await api.getPlugins(); enabled = Boolean(plugins.find(p => p.id === 'pydebug')?.enabled);
    prerequisites = ['editor', 'run-configurations'].filter(id => !plugins.find(p => p.id === id)?.enabled).map(id => `Enable ${id === 'editor' ? 'Editor' : 'Run Configurations'} in Settings`).join('; ');
    removeRunAction?.(); removeRunAction = null;
    if (!enabled) { setDebugProvider(null); return; }
    setDebugProvider(prerequisites ? null : provider);
    removeRunAction = registerRunAction('pydebug', { label: 'Debug', icon: 'bug',
      unsupported: config => prerequisites || (config?.type !== 'python' || config?.tmux ? 'PyDebug supports Python scripts/modules without tmux' : ''),
      async start({ configuration, project }) {
        await prepare(configuration.host, project?.id || '');
        const result = await call('start', { configurationId: configuration.id, projectId: project?.id || '', projectName: project?.name || '' }); selectedId = result.session.id; threadId = null;
        await refresh(); if (result.session.state !== 'paused') openView('editor', {});
        return result;
      }
    });
    await refresh();
  }
  registerView('pydebug', { title: 'PyDebug', iconClass: 'icon-bug', supports: ['ssh', 'local'], mount: container => provider.mountPanel(container, 'Breakpoints') });
  registerCommand?.('PyDebug: Breakpoints', () => openView('pydebug', {}));
  registerCommand?.('PyDebug: Debugger', () => openView('editor', {}));
  api.onPyDebugChanged?.(refresh); api.onPluginsChanged?.(() => configure().catch(showError));
  window.addEventListener('marinashell:groups-changed', renderPanels);
  window.addEventListener('marinashell:editor:saved', event => { flushMapped(event.detail).catch(showError); });
  configure().catch(showError);
}
