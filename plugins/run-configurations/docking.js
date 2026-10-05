import { createPaneDocking } from '../../renderer/components/paneDocking.js';
const M = globalThis.MarinaDocking;

export function createConfigurationDocking({ state, sessionTabs, views, runs, ensureView, detachView, onSelect, onChange }) {
  const models = new Map(), activeMembers = new Map();
  const root = sessionTabs.configurationRoot;
  const projectId = () => state.tabs.get(state.activeTabId)?.groupId || '';
  const model = () => models.get(projectId()) || M.empty('configuration');
  let draggingNew = '', previousMode = 'terminal';
  const fit = () => {
    for (const view of views.values()) if (view.tab.container.classList.contains('grid-visible') && view.tab.container.getBoundingClientRect().height) {
      try { view.tab.fitAddon.fit(); } catch { /* Hidden xterms fit on the next render. */ }
    }
  };
  function changed(next) {
    M.validate(next, 'configuration');
    if (M.members(next).some(key => !views.has(key) || views.get(key).projectId !== projectId())) throw new Error('Configuration output belongs to another workspace.');
    models.set(projectId(), next); render(); onChange();
  }
  function activate(key) {
    const view = views.get(key); if (!view || view.projectId !== projectId()) return;
    models.set(projectId(), M.activate(model(), key)); activeMembers.set(projectId(), key);
    sessionTabs.setWorkspaceMode('configuration'); onSelect(runs.get(key)); render(); onChange();
    window.dispatchEvent(new Event('marinashell:focus-terminal'));
    view.tab.term.focus();
  }
  function hide(key) {
    const view = views.get(key); if (!view) return;
    const current = models.get(view.projectId) || M.empty('configuration');
    const next = M.remove(current, key); models.set(view.projectId, next);
    if (activeMembers.get(view.projectId) === key) activeMembers.set(view.projectId, M.order(next)[0] || '');
    detachView(key); render(); onChange();
  }
  const surface = createPaneDocking({
    root, kind: 'configuration', group: projectId, getModel: model, setModel: changed,
    getMember: key => views.get(key)?.tab,
    getLabel: key => views.get(key)?.tab.manualTitle || runs.get(key)?.name || 'Output',
    activate, close: hide, fit,
    dragStart: key => {
      previousMode = state.workspaceMode || 'terminal';
      if (!views.has(key)) { ensureView(key); draggingNew = key; }
      sessionTabs.setWorkspaceMode('configuration');
    },
    dragEnd: ({ committed, started }) => {
      if (draggingNew && !committed) detachView(draggingNew);
      draggingNew = '';
      if (started && !committed) sessionTabs.setWorkspaceMode(previousMode);
      render(); onChange();
    },
    error: error => console.error('Configuration docking:', error.message)
  });
  function render() {
    for (const view of views.values()) if (view.projectId !== projectId()) {
      view.tab.container.hidden = true; view.tab.container.classList.remove('grid-visible', 'active');
    }
    surface.render(model(), activeMembers.get(projectId()) || '');
  }
  sessionTabs.registerConfigurationWorkspace({ render, closeActive: () => hide(activeMembers.get(projectId())), focusActive: () => views.get(activeMembers.get(projectId()))?.tab.term.focus() });
  window.addEventListener('marinashell:workspace-mode-changed', () => { render(); onChange(); });
  function show(key) {
    if (!views.has(key)) ensureView(key);
    const view = views.get(key); if (!view) return;
    if (view.projectId !== projectId()) {
      const terminal = [...state.tabs.values()].find(tab => !tab.readOnly && tab.groupId === view.projectId);
      if (!terminal) { detachView(key); throw new Error('Open the configuration’s project before showing its output.'); }
      sessionTabs.setActiveSessionTab(terminal.id);
    }
    let current = model();
    if (!M.find(current, key)) {
      const target = M.find(current, activeMembers.get(projectId())) || M.leaves(current.root).at(-1);
      try { current = M.dock(current, key, target?.id || '', 'centre', 'configuration'); }
      catch (error) { detachView(key); throw error; }
      models.set(projectId(), current);
    }
    activate(key);
  }
  return {
    show, hide, render, fit, activate,
    bind: (el, key) => surface.bind(el, key),
    isOpen: key => { const view = views.get(key); return Boolean(view && M.find(models.get(view.projectId) || M.empty('configuration'), key)); },
    isFocused: key => state.workspaceMode === 'configuration' && activeMembers.get(projectId()) === key && M.find(model(), key)?.activeId === key,
    replace: (oldKey, newKey) => {
      const view = views.get(newKey); if (!view) return;
      const current = models.get(view.projectId); if (!current) return;
      const next = M.copy(current);
      for (const pane of M.leaves(next.root)) {
        pane.memberIds = pane.memberIds.map(key => key === oldKey ? newKey : key);
        if (pane.activeId === oldKey) pane.activeId = newKey;
      }
      models.set(view.projectId, M.validate(next, 'configuration'));
      if (activeMembers.get(view.projectId) === oldKey) activeMembers.set(view.projectId, newKey);
      render(); onChange();
    },
    closeProject: project => {
      for (const [key, view] of [...views]) if (view.projectId === project) detachView(key);
      models.delete(project); activeMembers.delete(project); render(); onChange();
    }
  };
}
