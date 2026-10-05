import { createPaneDocking } from './paneDocking.js';
import { GROUP_LAYOUTS } from '../constants.js';
import { layoutRectangles } from '../services/terminalLayout.js';
const M = globalThis.MarinaDocking;

export function createTerminalDocking({ state, terminalStack, strip, newTabButton, getLabel, getGroup, activateTab, closeTab, contextMenu, fit, persistence }) {
  const header = document.createElement('div'); header.className = 'terminal-workspace-switch';
  const terminalButton = document.createElement('button'); terminalButton.textContent = 'Terminals'; terminalButton.dataset.workspaceMode = 'terminal';
  const configurationButton = document.createElement('button'); configurationButton.textContent = 'Configurations'; configurationButton.dataset.workspaceMode = 'configuration'; configurationButton.disabled = true;
  const saveState = document.createElement('button'); saveState.className = 'layout-save-state'; saveState.hidden = true;
  saveState.addEventListener('click', () => persistence.persistTabs());
  header.append(terminalButton, configurationButton, saveState);
  const terminalRoot = document.createElement('div'); terminalRoot.className = 'terminal-docking';
  const configurationRoot = document.createElement('div'); configurationRoot.className = 'configuration-docking'; configurationRoot.hidden = true;
  terminalStack.append(header, terminalRoot, configurationRoot); terminalStack.classList.add('docking-workspace');
  let configurationWorkspace = null, previewDock = false;
  const modes = new Map();
  const groupId = () => state.tabs.get(state.activeTabId)?.groupId || '';
  const tabs = projectId => [...state.tabs.values()].filter(tab => !tab.readOnly && (tab.groupId || '') === projectId);
  const holder = projectId => projectId ? getGroup(projectId) : state.appState;
  const field = projectId => projectId ? 'dockLayout' : 'scratchDockLayout';

  function model(projectId = groupId()) {
    const group = holder(projectId); if (!group) return M.empty('terminal');
    const keys = tabs(projectId).map(tab => tab.sessionKey);
    let value = group[field(projectId)];
    try { if (value) M.validate(value, 'terminal'); } catch { value = null; }
    if (!value) {
      const preset = GROUP_LAYOUTS.find(item => item.id === group.layout) || GROUP_LAYOUTS[0];
      value = M.migrate('terminal', keys, group.terminalLayout || layoutRectangles(preset));
    }
    value = M.reconcile(value, keys); group[field(projectId)] = value;
    return value;
  }
  function member(key) { return tabs(groupId()).find(tab => tab.sessionKey === key); }
  function sortTabs() {
    if (!state.appState) return;
    const projectId = groupId(), byKey = new Map(tabs(projectId).map(tab => [tab.sessionKey, tab]));
    const ordered = M.order(model()).map(key => byKey.get(key)).filter(Boolean);
    const next = new Map(); let inserted = false;
    for (const tab of state.tabs.values()) {
      if (byKey.has(tab.sessionKey)) {
        if (!inserted) { ordered.forEach(item => next.set(item.id, item)); inserted = true; }
      } else next.set(tab.id, tab);
    }
    state.tabs = next;
  }
  function changed(next, { persist = true } = {}) {
    const group = holder(groupId()); if (!group) return;
    group[field(groupId())] = M.validate(next, 'terminal');
    sortTabs(); render();
    window.dispatchEvent(new Event('marinashell:docking-changed'));
    if (persist) persistence.persistTabs();
  }
  const surface = createPaneDocking({
    root: terminalRoot, kind: 'terminal', group: groupId, getModel: model, setModel: changed,
    getMember: member, getLabel: key => getLabel(member(key)), fit,
    activate: key => { const tab = member(key); if (tab) activateTab(tab.id); },
    close: key => { const tab = member(key); if (tab) closeTab(tab.id); },
    contextMenu: (event, key) => { const tab = member(key); if (tab) contextMenu(event, tab.id); },
    dragStart: () => { previewDock = true; setMode('terminal'); },
    dragEnd: () => { previewDock = false; render(); },
    reorder: (source, target, after) => { changed(M.reorder(model(), source, target, after)); return true; },
    error: failure => persistence.setStatus(failure.message, true)
  });
  terminalButton.addEventListener('click', () => setMode('terminal'));
  configurationButton.addEventListener('click', () => setMode('configuration'));
  window.addEventListener('marinashell:docking-changed', () => {
    window.dispatchEvent(new Event('marinashell:render-terminal-tabs'));
  });
  window.addEventListener('marinashell:layout-save-state', event => {
    const status = event.detail;
    saveState.hidden = status.status === 'saved';
    saveState.textContent = status.status === 'error' ? 'Unsaved · Retry' : 'Saving…';
    saveState.disabled = status.status !== 'error'; saveState.title = status.error || '';
  });

  function setMode(mode) {
    if (mode === 'configuration' && !configurationWorkspace) return;
    modes.set(groupId(), mode); render();
    window.dispatchEvent(new CustomEvent('marinashell:workspace-mode-changed', { detail: { mode, projectId: groupId() } }));
  }
  function render() {
    if (!state.appState) return;
    let mode = modes.get(groupId()) || 'terminal';
    if (!configurationWorkspace) mode = 'terminal';
    state.workspaceMode = mode;
    terminalRoot.hidden = mode !== 'terminal'; configurationRoot.hidden = mode !== 'configuration';
    strip.hidden = mode !== 'terminal'; strip.parentElement.hidden = mode !== 'terminal'; if (newTabButton) newTabButton.hidden = mode !== 'terminal';
    for (const button of [terminalButton, configurationButton]) {
      const selected = button.dataset.workspaceMode === mode;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    }
    const value = model(), active = state.tabs.get(state.activeTabId);
    const key = active?.sessionKey || '';
    const display = value.standaloneIds.includes(key) && !previewDock
      ? { ...M.empty('terminal'), root: { type: 'pane', id: `standalone-${key}`, memberIds: [key], activeId: key } }
      : value;
    // Other projects' xterms stay mounted but must not remain visible.
    for (const tab of state.tabs.values()) if ((tab.groupId || '') !== groupId() || tab.readOnly) {
      tab.container.hidden = true; tab.container.classList.remove('grid-visible', 'active');
    }
    surface.render(display, key);
    configurationWorkspace?.render(groupId());
  }
  function select(tab) {
    if (!tab || tab.readOnly || !state.appState) return;
    const group = holder(tab.groupId || '');
    if (group) group[field(tab.groupId || '')] = M.activate(model(tab.groupId || ''), tab.sessionKey);
    modes.set(tab.groupId || '', 'terminal');
  }
  function moveOut(tabId) {
    const tab = state.tabs.get(tabId); if (!tab || tab.readOnly) return;
    const projectId = tab.groupId || '', group = holder(projectId);
    group[field(projectId)] = M.moveOut(model(projectId), tab.sessionKey);
    activateTab(tabId); sortTabs(); window.dispatchEvent(new Event('marinashell:render-terminal-tabs'));
  }
  function dockTab(tabId, targetTabId, zone) {
    const tab = state.tabs.get(tabId), target = state.tabs.get(targetTabId);
    if (!tab || !target || tab.readOnly || target.readOnly || (tab.groupId || '') !== (target.groupId || '')) return false;
    const value = model(tab.groupId || ''), p = M.find(value, target.sessionKey);
    changed(M.dock(value, tab.sessionKey, p?.id || '', zone, 'terminal')); activateTab(tabId); return true;
  }
  function reorderTab(sourceId, targetId, after) {
    const source = state.tabs.get(sourceId), target = state.tabs.get(targetId);
    if (!source || !target || source.readOnly || target.readOnly || (source.groupId || '') !== (target.groupId || '')) return false;
    changed(M.reorder(model(source.groupId || ''), source.sessionKey, target.sessionKey, after)); return true;
  }
  function setPreset(projectId, layoutId) {
    const group = holder(projectId); if (!group) return;
    group.layout = layoutId; delete group.terminalLayout;
    group[field(projectId)] = M.migrate('terminal', tabs(projectId).map(tab => tab.sessionKey), layoutRectangles(GROUP_LAYOUTS.find(item => item.id === layoutId) || GROUP_LAYOUTS[0]));
    sortTabs(); render();
  }
  return {
    render, select, moveOut, dockTab, reorderTab, setPreset, model, sortTabs, setMode,
    isDocked: tabId => { const tab = state.tabs.get(tabId); return Boolean(tab && !tab.readOnly && M.find(model(tab.groupId || ''), tab.sessionKey)); },
    bind: (element, tab) => surface.bind(element, tab.sessionKey, { reorder: true }),
    registerConfigurationWorkspace: workspace => { configurationWorkspace = workspace; configurationButton.disabled = false; render(); return configurationRoot; },
    configurationRoot,
    closeActiveConfiguration: () => configurationWorkspace?.closeActive(),
    focusActiveConfiguration: () => configurationWorkspace?.focusActive(),
    remove: tab => {
      if (!tab || tab.readOnly) return;
      const projectId = tab.groupId || '', group = holder(projectId);
      if (group?.[field(projectId)]) group[field(projectId)] = M.remove(group[field(projectId)], tab.sessionKey);
    }
  };
}
