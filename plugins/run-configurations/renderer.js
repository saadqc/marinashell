import { editConfigurations } from './editor.js';
import { createConfigurationDocking } from './docking.js';
import { button, modal, confirmAction, showError } from '../../renderer/components/dialog.js';
import { runActions, subscribeRunActions, debugProvider } from '../../renderer/services/debugIntegration.js';

const ended = run => run && ['exited', 'failed', 'blocked'].includes(run.status);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export default function activate({ api, state, sessionTabs, dockLayout, registerCommand }) {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./style.css', import.meta.url).href; document.head.append(css);
  const toolbar = document.createElement('div'); toolbar.id = 'run-toolbar'; toolbar.setAttribute('aria-label', 'Run configurations');
  document.getElementById('sidebar').append(toolbar);
  const chooser = document.createElement('select'); chooser.setAttribute('aria-label', 'Run configuration');
  const status = document.createElement('span'); status.className = 'run-status';
  let configurations = []; let selectedId = state.appState.selectedRunConfigurationId || ''; let tmuxAvailable = false;
  const runs = new Map(); const views = new Map(); const polling = new Set();
  const outputMenu = document.createElement('div'); outputMenu.className = 'context-menu'; document.body.append(outputMenu);
  const hideOutputMenu = () => outputMenu.classList.remove('open');
  document.addEventListener('pointerdown', event => { if (!outputMenu.contains(event.target)) hideOutputMenu(); });
  window.addEventListener('blur', hideOutputMenu);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideOutputMenu(); });
  // Session-scoped indicator list: runs launched (or opened) in this window,
  // minus the ones dismissed with the row's ✕. Never touches stored records.
  const sessionRunIds = new Set(); const dismissedRunIds = new Set();
  let launching = false;
  let controls;
  const actionButtons = new Map();
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
    return `${label} · ${run.host === '__local__' ? 'Local' : run.host}${run.tmux ? ' · tmux' : ''}${run.executionMode === 'debug' ? ' · Debug' : ''}`;
  }
  function selectConfig(id) {
    selectedId = id; chooser.value = id; state.appState.selectedRunConfigurationId = id;
    api.updateState({ selectedRunConfigurationId: id }); updateControls();
  }
  function selectedGroup() {
    const groups = state.appState.tabGroups || [];
    return groups.find(g => g.id === state.tabs.get(state.activeTabId)?.groupId) || null;
  }
  function renderChoices() {
    chooser.replaceChildren();
    const activeGroup = selectedGroup();
    // Only the selected workspace's configurations are offered; an ungrouped
    // tab falls back to the whole library.
    const visible = activeGroup
      ? configurations.filter(config => (activeGroup.configurationIds || []).includes(config.id))
      : configurations;
    if (visible.length) {
      // The launcher shows only this project's configurations, but names repeat
      // across projects; keep the owning project visible in each choice.
      const projectsByConfig = new Map();
      for (const group of state.appState.tabGroups || []) {
        for (const id of group.configurationIds || []) {
          if (!projectsByConfig.has(id)) projectsByConfig.set(id, []);
          projectsByConfig.get(id).push(group.name);
        }
      }
      for (const config of visible) {
        const projects = (projectsByConfig.get(config.id) || []).join(', ');
        chooser.append(new Option(projects ? `${config.name} — ${projects}` : config.name, config.id));
      }
    } else {
      chooser.append(new Option(activeGroup ? `No configurations in ${activeGroup.name}` : 'No configurations', ''));
    }
    if (!visible.some(config => config.id === selectedId)) {
      selectedId = visible[0]?.id || '';
    }
    chooser.value = selectedId; updateControls();
  }
  function updateControls() {
    const run = activeRun(); const config = configurations.find(c => c.id === selectedId);
    const active = run && !ended(run);
    if (controls) {
      const actions = runActions();
      for (const [id, element] of actionButtons) if (!actions.some(([key]) => key === id)) { element.remove(); actionButtons.delete(id); }
      for (const [id, action] of actions) {
        if (!actionButtons.has(id)) {
          const element = icon(action.icon || 'bug', action.label, async () => {
            if (launching || !selectedId) return;
            launching = true; updateControls();
            try {
              const result = await action.start({ configuration: configurations.find(c => c.id === selectedId), project: selectedGroup() });
              if (result?.run) { runs.set(result.run.id, result.run); sessionRunIds.add(result.run.id); }
            } catch (error) { showError(error); }
            finally { launching = false; updateControls(); }
          }, 'run-debug');
          controls.insertBefore(element, restart); actionButtons.set(id, element); icons(controls);
        }
        const element = actionButtons.get(id); const reason = action.unsupported?.(config);
        element.disabled = !config || launching || Boolean(active) || Boolean(reason);
        element.title = reason || (active ? 'Stop this configuration before debugging' : action.label);
      }
    }
    play.hidden = Boolean(active && !config?.multiInstance); play.disabled = !config || launching;
    restart.hidden = !active; stop.hidden = !active;
    restart.disabled = !run || run.status === 'unknown' || run.status === 'stopping';
    stop.disabled = !run || run.status === 'unknown';
    stop.title = run?.status === 'stopping' ? 'Force kill' : 'Stop'; stop.setAttribute('aria-label', stop.title);
    status.textContent = describe(run); status.title = run?.error || status.textContent;
    renderRunChip();

    for (const [id, view] of views) {
      const value = runs.get(id); if (!value) continue;
      view.label.textContent = describe(value); view.label.title = value.error || view.label.textContent;
      view.stop.hidden = ended(value); view.restart.hidden = false;
      view.stop.disabled = value.status === 'unknown'; view.restart.disabled = value.status === 'unknown' || value.status === 'stopping';
      view.stop.textContent = value.status === 'stopping' ? 'Force kill' : 'Stop';
      view.retry.hidden = value.status !== 'unknown';
      view.tab.statusMessage = describe(value);
    }
  }
  function runDotClass(status) {
    return { running: 'running', starting: 'busy', stopping: 'busy' }[status] || (status === 'exited' ? 'exited' : 'failed');
  }
  function runDisplayName(run) {
    return `${run.groupName ? `${run.groupName}: ` : ''}${run.name}${run.multiInstance && run.instance > 1 ? ` #${run.instance}` : ''}`;
  }
  function renderRunChip() {
    runList.replaceChildren();
    const group = selectedGroup();
    const listed = [...runs.values()].reverse().filter(run => sessionRunIds.has(run.id) && !run.closed
      && !dismissedRunIds.has(run.id) && (group ? run.groupId === group.id : !run.groupId));
    // Active runs stay on top; ended ones remain listed until dismissed.
    const ordered = [...listed.filter(run => !ended(run)), ...listed.filter(run => ended(run))];
    for (const run of ordered) {
      const row = document.createElement('div'); row.className = 'running-configuration';
      row.classList.toggle('ended', ended(run));
      row.dataset.runId = run.id;
      const chip = button('', () => showOutput(run), 'run-chip');
      const dot = document.createElement('span'); dot.className = `running-dot ${run.status}`;
      const label = document.createElement('span'); label.textContent = runDisplayName(run);
      chip.title = describe(run); chip.setAttribute('aria-label', `${runDisplayName(run)}: ${describe(run)}`);
      chip.append(dot, label); row.append(chip);
      configurationDocking.bind(chip, run.id);
      const open = configurationDocking.isOpen(run.id);
      const visibility = icon('panel-top', `${open ? 'Hide' : 'Show'} ${run.name} output`, event => {
        event.stopPropagation();
        if (configurationDocking.isOpen(run.id)) configurationDocking.hide(run.id);
        else showOutput(run);
      }, 'run-pane-visibility');
      visibility.dataset.noDrag = 'true'; visibility.setAttribute('aria-pressed', String(open));
      visibility.classList.toggle('shown', open);
      visibility.classList.toggle('focused', configurationDocking.isFocused(run.id));
      visibility.title = open ? 'Output open in configuration pane — hide output' : 'Show output in configuration pane';
      row.append(visibility);
      if (ended(run)) row.append(icon('x', 'Remove from list', () => { dismissedRunIds.add(run.id); renderRunChip(); }, 'run-dismiss'));
      runList.append(row);
    }
    icons(runList);
  }
  async function fetchLibrary(id) {
    const data = await call('list'); configurations = data.configurations; tmuxAvailable = data.tmuxAvailable;
    for (const run of data.runs) {
      // Runs started outside this window (agent tools) join the indicator
      // while they are still going; ended history from earlier windows does not.
      if (!runs.has(run.id) && !ended(run)) sessionRunIds.add(run.id);
      runs.set(run.id, run);
    }
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
      if (views.get(id) !== view) return;
      const tab = view.tab;
      runs.set(id, result.run);
      if (result.reset) tab.term.writeln('\r\n[Older output was rotated on the execution host]\r\n');
      if (result.output) tab.term.write(result.output);
      view.offset = result.offset; view.generation = result.generation; view.drained = ended(result.run) && !result.hasMore;
      updateControls();
    } catch (error) { const run = runs.get(id); if (views.get(id) === view && run) { run.status = 'unknown'; run.error = error.message; updateControls(); } }
    finally { polling.delete(id); }
  }
  async function refreshRun(id) {
    if (views.has(id)) return pollRun(id);
    const result = await call('status', { id });
    runs.set(id, result.run); updateControls();
  }
  function createOutputView(run, replacement) {
    runs.set(run.id, run); sessionRunIds.add(run.id);
    const container = replacement?.tab.container || document.createElement('div');
    container.className = 'terminal-pane run-output configuration-output';
    container.dataset.memberKey = run.id; container.dataset.runId = run.id; container.hidden = true;
    const shell = state.tabs.get(state.activeTabId);
    const term = replacement?.tab.term || new window.Terminal({
      fontFamily: shell?.term.options.fontFamily || '"JetBrains Mono", monospace',
      fontSize: shell?.term.options.fontSize || 13, theme: shell?.term.options.theme,
      disableStdin: true, cursorBlink: false, convertEol: true
    });
    const fitAddon = replacement?.tab.fitAddon || new (window.FitAddon.FitAddon || window.FitAddon)();
    if (!replacement) {
      const output = document.createElement('div'); output.className = 'run-output-terminal'; container.append(output);
      sessionTabs.configurationRoot.append(container); term.loadAddon(fitAddon); term.open(output);
      term.attachCustomKeyEventHandler(event => {
        const modifier = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
        if (modifier && !event.altKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
          if (event.type === 'keydown') api.copyToClipboard(term.getSelection()).catch(showError);
          return false;
        }
        return true;
      });
      container.addEventListener('pointerdown', event => { if (!event.target.closest('button')) configurationDocking.activate(container.dataset.runId); });
      container.addEventListener('contextmenu', event => {
        event.preventDefault(); event.stopPropagation();
        const current = views.get(container.dataset.runId); if (!current) return;
        const copy = button('Copy', () => { api.copyToClipboard(current.tab.term.getSelection()).catch(showError); hideOutputMenu(); });
        copy.disabled = !current.tab.term.hasSelection();
        outputMenu.replaceChildren(copy, button('Select all', () => { current.tab.term.selectAll(); hideOutputMenu(); }), button('Hide output', () => { configurationDocking.hide(container.dataset.runId); hideOutputMenu(); }));
        outputMenu.classList.add('open');
        outputMenu.style.left = `${Math.max(0,Math.min(event.clientX,innerWidth-outputMenu.offsetWidth-8))}px`;
        outputMenu.style.top = `${Math.max(0,Math.min(event.clientY,innerHeight-outputMenu.offsetHeight-8))}px`;
      });
    } else { container.querySelector('.run-output-bar')?.remove(); term.reset(); }
    const tab = { id: `output-${run.id}`, term, fitAddon, container, runId: run.id, configurationId: run.configurationId,
      manualTitle: `${run.name}${run.multiInstance && run.instance > 1 ? ` #${run.instance}` : ''}` };
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
    const projectId = run.groupId || state.tabs.get(state.activeTabId)?.groupId || '';
    const view = { tab, projectId, offset: 0, generation: 0, label, stop: stopButton, restart: restartButton, retry };
    views.set(run.id, view); pollRun(run.id); return view;
  }
  function detachOutputView(id) {
    const view = views.get(id); if (!view) return;
    views.delete(id); view.tab.container.remove();
    requestAnimationFrame(() => { view.tab.term._core?._renderService?._pausedResizeTask?.flush(); view.tab.term.dispose(); });
  }
  const configurationDocking = createConfigurationDocking({
    state, sessionTabs, views, runs,
    ensureView: id => { const run = runs.get(id); if (run && !views.has(id)) createOutputView(run); },
    detachView: detachOutputView, onSelect: run => { if (run) selectConfig(run.configurationId); }, onChange: updateControls
  });
  async function start() {
    if (launching || !selectedId) return;
    launching = true; updateControls();
    try {
      const active = state.tabs.get(state.activeTabId);
      const group = state.appState.tabGroups?.find(g => g.id === active?.groupId);
      const result = await call('start', { id: selectedId, groupId: group?.id || '', groupName: group?.name || '' });
      runs.set(result.run.id, result.run); sessionRunIds.add(result.run.id);
      // Starting a new run never recycles a previous output or shell tab.
      updateControls();
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
    const oldView = views.get(id);
    try {
      const restarting = runs.get(id);
      if (restarting?.executionMode === 'debug') await debugProvider()?.prepare(restarting.host, restarting.groupId || '');
      // Stop remains usable while Restart waits for a graceful shutdown.
      const run = runs.get(id); if (run) run.status = 'stopping'; updateControls();
      const result = await call('restart', { id });
      if (result.run.id !== id) {
        await call('close', { id });
        const old = runs.get(id); if (old) old.closed = true;
      }
      runs.set(result.run.id, result.run); sessionRunIds.add(result.run.id);
      // Keep an already-open output view attached across the restart.
      if (oldView) {
        views.delete(id);
        createOutputView(result.run, oldView);
        configurationDocking.replace(id, result.run.id);
      }
      updateControls();
    } catch (error) { showError(error); pollRun(id); }
  }
  async function showOutput(run) {
    runs.set(run.id, run); sessionRunIds.add(run.id);
    try { configurationDocking.show(run.id); }
    catch (error) { showError(error); }
  }
  const play = icon('play', 'Run', start, 'run-play');
  const restart = icon('rotate-cw', 'Restart', () => restartRun(activeRun()?.id));
  const stop = icon('square', 'Stop', () => stopRun(activeRun()?.id));
  const runList = document.createElement('div'); runList.className = 'running-configurations';
  const edit = button('Edit configurations…', openEditor);
  const recover = button('Runs…', async () => {
    try {
      const data = await fetchLibrary(); const view = modal('Configuration runs');
      if (!data.runs.length) view.body.textContent = 'No runs yet.';
      for (const run of [...data.runs].reverse()) {
        const row = document.createElement('div'); row.className = 'workspace-library-row';
        const info = document.createElement('div'); info.textContent = `${run.name} #${run.instance}`;
        const detail = document.createElement('small'); detail.textContent = describe(run); info.append(detail);
        row.append(info, button('Open', () => { showOutput(run); view.close(); })); view.body.append(row);
      }
      view.footer.append(button('Close', view.close));
    } catch (error) { showError(error); }
  });
  const heading = document.createElement('div'); heading.className = 'run-section-heading';
  const title = document.createElement('span'); title.textContent = 'Run configurations';
  const manage = icon('settings-2', 'Edit configurations', openEditor);
  heading.append(title, manage);
  controls = document.createElement('div'); controls.className = 'run-launcher'; controls.append(chooser, play, restart, stop);
  toolbar.append(heading, controls, runList); icons(toolbar);
  subscribeRunActions(updateControls);
  registerCommand?.('Edit run configurations', openEditor);
  registerCommand?.('Browse configuration runs', () => recover.click());
  chooser.addEventListener('change', () => selectConfig(chooser.value));
  state.runController = {
    async beforeClose(tabs) {
      const targets = tabs.filter(tab => tab.runId).map(tab => runs.get(tab.runId)).filter(Boolean);
      for (const run of targets) await refreshRun(run.id);
      const active = targets.filter(run => !ended(runs.get(run.id)));
      if (!active.length) return true;
      if (!await confirmAction('Stop running configurations?', `Closing will stop ${active.map(run => `“${run.name}”`).join(', ')} and close their output tabs.`, 'Stop and close')) return false;
      try {
        for (const run of active) {
          const result = await call('stop', { id: run.id }); runs.set(run.id, result.run);
        }
        updateControls();
        for (let i = 0; i < 32; i++) {
          await Promise.all(active.map(run => refreshRun(run.id)));
          if (active.every(run => ended(runs.get(run.id)))) return true;
          await sleep(250);
        }
        if (!await confirmAction('Processes are still stopping', 'Force-kill these runs and close their output tabs?', 'Force kill and close')) return false;
        for (const run of active.filter(run => !ended(runs.get(run.id)))) await call('stop', { id: run.id, force: true });
        for (let i = 0; i < 20; i++) {
          await Promise.all(active.map(run => refreshRun(run.id)));
          if (active.every(run => ended(runs.get(run.id)))) return true;
          await sleep(250);
        }
        throw new Error('Termination could not be confirmed. The output tabs and run records have been kept.');
      } catch (error) { showError(error); return false; }
    },
    async closed(tab) { await call('close', { id: tab.runId }); detachOutputView(tab.runId); const run = runs.get(tab.runId); if (run) run.closed = true; updateControls(); },
    async beforeCloseProject(projectId) {
      return this.beforeClose([...runs.values()].filter(run => run.groupId === projectId && !run.closed).map(run => ({ runId: run.id })));
    },
    async closedProject(projectId) {
      configurationDocking.closeProject(projectId);
      for (const run of runs.values()) if (run.groupId === projectId && ended(run)) { await call('close', { id: run.id }); run.closed = true; }
      updateControls();
    }
  };
  window.addEventListener('marinashell:active-tab-changed', () => {
    const tab = state.tabs.get(state.activeTabId); if (tab?.configurationId && configurations.some(c => c.id === tab.configurationId)) selectConfig(tab.configurationId); renderChoices();
  });
  window.addEventListener('marinashell:groups-changed', renderChoices);
  api.onRunConfigurationsChanged?.(() => { fetchLibrary().then(updateControls).catch(() => {}); });
  const timer = setInterval(() => {
    for (const id of views.keys()) {
      const run = runs.get(id); const view = views.get(id);
      // Continue draining final output; unknown runs are checked on reconnect.
      if (!ended(run) || !view.drained) pollRun(id);
    }
    // Runs without an open output view only need their status refreshed.
    for (const run of runs.values()) {
      if (run.closed || views.has(run.id) || ended(run)) continue;
      call('status', { id: run.id }).then(result => {
        runs.set(run.id, result.run); updateControls();
      }).catch(() => {
        const current = runs.get(run.id);
        if (current && current.status !== 'unknown') { current.status = 'unknown'; updateControls(); }
      });
    }
  }, 1000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
  fetchLibrary().then(data => {
    // Discard legacy output placeholders without closing managed run records.
    // New configuration pane placement is deliberately session-only.
    for (const tab of [...state.tabs.values()]) if (tab.readOnly && tab.runId) {
      tab.container.remove(); state.tabs.delete(tab.id);
      requestAnimationFrame(() => { tab.term._core?._renderService?._pausedResizeTask?.flush(); tab.term.dispose(); });
    }
    sessionTabs.renderSessionTabs(); sessionTabs.updateTerminalGrid();
    updateControls();
  }).catch(showError);
}
