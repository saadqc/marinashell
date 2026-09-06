import { editConfigurations } from './editor.js';
import { button, modal, confirmAction, showError } from '../../renderer/components/dialog.js';

const ended = run => run && ['exited', 'failed', 'blocked'].includes(run.status);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export default function activate({ api, state, sessionTabs }) {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./style.css', import.meta.url).href; document.head.append(css);
  const toolbar = document.createElement('div'); toolbar.id = 'run-toolbar'; toolbar.setAttribute('aria-label', 'Run configurations');
  document.getElementById('session-bar').append(toolbar);
  const chooser = document.createElement('select'); chooser.setAttribute('aria-label', 'Run configuration');
  const status = document.createElement('span'); status.className = 'run-status';
  let configurations = []; let selectedId = state.appState.selectedRunConfigurationId || ''; let tmuxAvailable = false;
  const runs = new Map(); const views = new Map(); const polling = new Set();
  let launching = false;
  function icon(name, label, action, className = '') {
    const el = button('', action, `icon-btn ${className}`); el.innerHTML = `<i data-icon="${name}"></i>`; el.title = label; el.setAttribute('aria-label', label); return el;
  }
  function icons(root) { window.lucide?.createIcons({ root, nameAttr: 'data-icon', attrs: { width: '16', height: '16', 'stroke-width': '1.9' } }); }
  async function call(name, payload = {}) {
    const result = await api.invoke(`plugin:run-configurations:${name}`, payload);
    if (!result?.ok) throw new Error(result?.error || 'Run configuration request failed');
    return result;
  }
  function activeRun() {
    const tab = state.tabs.get(state.activeTabId);
    if (tab?.runId && tab.configurationId === selectedId) return runs.get(tab.runId);
    return [...runs.values()].reverse().find(run => run.configurationId === selectedId && !run.closed);
  }
  function describe(run) {
    if (!run) return '';
    const label = { starting: 'Starting', running: 'Running', stopping: 'Stopping — press Stop again to force kill', unknown: 'Disconnected / status unknown', exited: `Exited (${run.exitCode ?? '?'})`, blocked: 'Single instance already running', failed: 'Failed' }[run.status] || run.status;
    return `${label} · ${run.host === '__local__' ? 'Local' : run.host}${run.tmux ? ' · tmux' : ''}`;
  }
  function selectConfig(id) {
    selectedId = id; chooser.value = id; state.appState.selectedRunConfigurationId = id;
    api.updateState({ selectedRunConfigurationId: id }); updateControls();
  }
  function renderChoices() {
    chooser.replaceChildren();
    const group = state.appState.tabGroups?.find(g => g.id === state.tabs.get(state.activeTabId)?.groupId);
    const linked = configurations.filter(config => group?.configurationIds?.includes(config.id));
    const remaining = configurations.filter(config => !linked.includes(config));
    function add(label, configs) {
      if (!configs.length) return;
      const options = document.createElement('optgroup'); options.label = label;
      for (const config of configs) options.append(new Option(config.name, config.id)); chooser.append(options);
    }
    add(group?.name || 'Group', linked); add('All configurations', remaining);
    if (!configurations.length) chooser.append(new Option('No configurations', ''));
    if (!configurations.some(c => c.id === selectedId)) selectedId = linked[0]?.id || configurations[0]?.id || '';
    chooser.value = selectedId; updateControls();
  }
  function updateControls() {
    const run = activeRun(); const config = configurations.find(c => c.id === selectedId);
    const active = run && !ended(run);
    play.hidden = Boolean(active && !config?.multiInstance); play.disabled = !config || launching;
    restart.hidden = !active; stop.hidden = !active;
    restart.disabled = !run || run.status === 'unknown' || run.status === 'stopping';
    stop.disabled = !run || run.status === 'unknown';
    stop.title = run?.status === 'stopping' ? 'Force kill' : 'Stop'; stop.setAttribute('aria-label', stop.title);
    status.textContent = describe(run); status.title = run?.error || status.textContent;
    for (const [id, view] of views) {
      const value = runs.get(id); if (!value) continue;
      view.label.textContent = describe(value); view.label.title = value.error || view.label.textContent;
      view.stop.hidden = ended(value); view.restart.hidden = ended(value);
      view.stop.disabled = value.status === 'unknown'; view.restart.disabled = value.status === 'unknown' || value.status === 'stopping';
      view.stop.textContent = value.status === 'stopping' ? 'Force kill' : 'Stop';
      view.retry.hidden = value.status !== 'unknown';
      const tab = state.tabs.get(view.tabId); if (tab) { tab.statusMessage = describe(value); tab.isBusy = !ended(value); }
    }
  }
  async function fetchLibrary(id) {
    const data = await call('list'); configurations = data.configurations; tmuxAvailable = data.tmuxAvailable;
    for (const run of data.runs) runs.set(run.id, run);
    if (id) selectConfig(id); renderChoices(); return data;
  }
  async function openEditor() {
    try { await fetchLibrary(); await editConfigurations({ api, state, call, selectedId, tmuxAvailable, onSaved: fetchLibrary }); }
    catch (error) { showError(error); }
  }
  async function pollRun(id) {
    const view = views.get(id); if (!view || polling.has(id)) return;
    polling.add(id);
    try {
      const result = await call('poll', { id, offset: view.offset, generation: view.generation });
      const tab = state.tabs.get(view.tabId); if (!tab) return;
      runs.set(id, result.run);
      if (result.reset) tab.term.writeln('\r\n[Older output was rotated on the execution host]\r\n');
      if (result.output) tab.term.write(result.output);
      view.offset = result.offset; view.generation = result.generation; view.drained = ended(result.run) && !result.hasMore;
      updateControls();
    } catch (error) { const run = runs.get(id); if (run) { run.status = 'unknown'; run.error = error.message; updateControls(); } }
    finally { polling.delete(id); }
  }
  function attach(run, { focus = true, replaceTab } = {}) {
    runs.set(run.id, run);
    if (views.has(run.id)) { if (focus) sessionTabs.setActiveSessionTab(views.get(run.id).tabId); return; }
    let tab = replaceTab || [...state.tabs.values()].find(tab => tab.runId === run.id);
    if (!tab) tab = [...state.tabs.values()].find(tab => tab.readOnly && !tab.runId && tab.configurationId === run.configurationId && tab.groupId === run.groupId);
    if (!tab) tab = sessionTabs.createTabState({
      host: run.host, currentPath: run.cwd || '/', readOnly: true, runId: run.id, configurationId: run.configurationId,
      manualTitle: `${run.name}${run.multiInstance && run.instance > 1 ? ` #${run.instance}` : ''}`,
      groupId: state.appState.tabGroups?.some(g => g.id === run.groupId) ? run.groupId : ''
    });
    if (replaceTab) {
      views.delete(replaceTab.runId); const old = runs.get(replaceTab.runId); if (old) old.closed = true;
      replaceTab.container.querySelector('.run-output-bar')?.remove(); replaceTab.term.clear();
    }
    tab.readOnly = true; tab.runId = run.id; tab.configurationId = run.configurationId;
    tab.term.options.disableStdin = true; tab.term.options.cursorBlink = false; tab.term.options.convertEol = true;
    tab.container.classList.add('run-output');
    const bar = document.createElement('div'); bar.className = 'run-output-bar';
    const label = document.createElement('span'); label.className = 'run-state';
    const stopButton = button('Stop', () => stopRun(run.id));
    const restartButton = button('Restart', () => restartRun(run.id));
    const retry = button('Check status', () => pollRun(run.id));
    const search = button('Find', () => {
      const view = modal('Find in output');
      const input = document.createElement('input'); input.placeholder = 'Search text'; input.setAttribute('aria-label', 'Search output'); view.body.append(input);
      const result = document.createElement('small'); view.body.append(result); let lineIndex = 0;
      function next() {
        const buffer = tab.term.buffer.active; const query = input.value.toLowerCase(); if (!query) return;
        for (let i = 0; i < buffer.length; i++) {
          const index = (lineIndex + i) % buffer.length; const text = buffer.getLine(index)?.translateToString(true) || '';
          const col = text.toLowerCase().indexOf(query);
          if (col >= 0) { tab.term.select(col, index, input.value.length); tab.term.scrollToLine(index); lineIndex = index + 1; result.textContent = `Line ${index + 1}`; return; }
        }
        result.textContent = 'No matches';
      }
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); next(); } });
      view.footer.append(button('Close', view.close), button('Find next', next)); input.focus();
    });
    bar.append(label, search, retry, restartButton, stopButton); tab.container.append(bar);
    views.set(run.id, { tabId: tab.id, offset: 0, generation: 0, label, stop: stopButton, restart: restartButton, retry });
    if (focus) { selectConfig(run.configurationId); sessionTabs.setActiveSessionTab(tab.id); window.dispatchEvent(new CustomEvent('marinashell:focus-terminal')); }
    sessionTabs.renderSessionTabs(); sessionTabs.updateTerminalGrid(); updateControls(); pollRun(run.id);
  }
  async function start() {
    if (launching || !selectedId) return;
    launching = true; updateControls();
    try {
      const active = state.tabs.get(state.activeTabId);
      const group = state.appState.tabGroups?.find(g => g.id === active?.groupId);
      const result = await call('start', { id: selectedId, groupId: group?.id || '', groupName: group?.name || '' });
      const previous = !result.run.multiInstance && [...views.keys()].reverse().find(id => id !== result.run.id && runs.get(id)?.configurationId === selectedId && ended(runs.get(id)));
      const oldTab = previous ? state.tabs.get(views.get(previous)?.tabId) : null;
      if (previous) await call('close', { id: previous });
      attach(result.run, { replaceTab: oldTab });
    } catch (error) { showError(error); }
    finally { launching = false; updateControls(); }
  }
  async function stopRun(id) {
    if (!id) return;
    try { const result = await call('stop', { id, force: runs.get(id)?.status === 'stopping' }); runs.set(id, result.run); updateControls(); }
    catch (error) { showError(error); }
  }
  async function restartRun(id) {
    if (!id) return;
    const tab = state.tabs.get(views.get(id)?.tabId);
    try {
      // Stop remains usable while Restart waits for a graceful shutdown.
      const run = runs.get(id); if (run) run.status = 'stopping'; updateControls();
      const result = await call('restart', { id });
      if (result.run.id !== id) await call('close', { id });
      attach(result.run, { replaceTab: tab });
    } catch (error) { showError(error); pollRun(id); }
  }
  const play = icon('play', 'Run', start, 'run-play');
  const restart = icon('rotate-cw', 'Restart', () => restartRun(activeRun()?.id));
  const stop = icon('square', 'Stop', () => stopRun(activeRun()?.id));
  const edit = button('Edit configurations…', openEditor);
  const recover = button('Runs…', async () => {
    try {
      const data = await fetchLibrary(); const view = modal('Configuration runs');
      if (!data.runs.length) view.body.textContent = 'No runs yet.';
      for (const run of [...data.runs].reverse()) {
        const row = document.createElement('div'); row.className = 'workspace-library-row';
        const info = document.createElement('div'); info.textContent = `${run.name} #${run.instance}`;
        const detail = document.createElement('small'); detail.textContent = describe(run); info.append(detail);
        row.append(info, button('Open', () => { attach(run); view.close(); })); view.body.append(row);
      }
      view.footer.append(button('Close', view.close));
    } catch (error) { showError(error); }
  });
  toolbar.append(chooser, play, restart, stop, edit, recover, status); icons(toolbar);
  chooser.addEventListener('change', () => selectConfig(chooser.value));
  state.runController = {
    async beforeClose(tabs) {
      const targets = tabs.filter(tab => tab.runId).map(tab => runs.get(tab.runId)).filter(Boolean);
      for (const run of targets) await pollRun(run.id);
      const active = targets.filter(run => !ended(runs.get(run.id)));
      if (!active.length) return true;
      if (!await confirmAction('Stop running configurations?', `Closing will stop ${active.map(run => `“${run.name}”`).join(', ')} and close their output tabs.`, 'Stop and close')) return false;
      try {
        for (const run of active) {
          const result = await call('stop', { id: run.id }); runs.set(run.id, result.run);
        }
        updateControls();
        for (let i = 0; i < 32; i++) {
          await Promise.all(active.map(run => pollRun(run.id)));
          if (active.every(run => ended(runs.get(run.id)))) return true;
          await sleep(250);
        }
        if (!await confirmAction('Processes are still stopping', 'Force-kill these runs and close their output tabs?', 'Force kill and close')) return false;
        for (const run of active.filter(run => !ended(runs.get(run.id)))) await call('stop', { id: run.id, force: true });
        for (let i = 0; i < 20; i++) {
          await Promise.all(active.map(run => pollRun(run.id)));
          if (active.every(run => ended(runs.get(run.id)))) return true;
          await sleep(250);
        }
        throw new Error('Termination could not be confirmed. The output tabs and run records have been kept.');
      } catch (error) { showError(error); return false; }
    },
    async closed(tab) { await call('close', { id: tab.runId }); views.delete(tab.runId); const run = runs.get(tab.runId); if (run) run.closed = true; updateControls(); }
  };
  window.addEventListener('marinashell:active-tab-changed', () => {
    const tab = state.tabs.get(state.activeTabId); if (tab?.configurationId && configurations.some(c => c.id === tab.configurationId)) selectConfig(tab.configurationId); renderChoices();
  });
  window.addEventListener('marinashell:groups-changed', renderChoices);
  const timer = setInterval(() => {
    for (const id of views.keys()) {
      const run = runs.get(id); const view = views.get(id);
      // Continue draining final output; unknown runs are checked on reconnect.
      if (!ended(run) || !view.drained) pollRun(id);
    }
  }, 1000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
  fetchLibrary().then(data => {
    for (const run of data.runs) if (!ended(run) || [...state.tabs.values()].some(tab => tab.runId === run.id)) attach(run, { focus: false });
  }).catch(showError);
}
