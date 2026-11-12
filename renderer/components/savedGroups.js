import { modal, button, confirmAction, showError } from './dialog.js';

const groupKey = name => String(name || '').trim().toLocaleLowerCase();
const shellDefinitions = snapshot => (snapshot?.tabs || [])
  .map((tab, index) => ({ ...tab, sessionKey: tab.sessionKey || `${snapshot.id}:session:${index}` }))
  .filter(tab => !tab.readOnly && !tab.runOutput && !tab.runId);

export function createSavedGroups(state, tabs, askForText, getLabel) {
  const getGroup = groupId => state.appState.tabGroups.find(group => group.id === groupId);
  const membersOf = groupId => [...state.tabs.values()].filter(tab => !tab.readOnly && !tab.runOutput && !tab.runId && tab.groupId === groupId);
  const describe = tab => ({
    sessionKey: tab.sessionKey, host: tab.host, currentPath: tab.currentPath, initialPath: tab.initialPath, treeRootPath: tab.treeRootPath,
    manualTitle: tab.manualTitle || getLabel(tab), tabColor: tab.tabColor, connected: true, configurationId: tab.configurationId || ''
  });

  function rememberClosed(tab) {
    const group = getGroup(tab.groupId);
    if (!group || !tab.host || tab.readOnly || tab.runOutput || tab.runId || (!tab.hasConnected && tab.initialPath === '/')) return;
    const closed = describe(tab);
    closed.currentPath = closed.initialPath || closed.currentPath;
    group.closedTerminals = [closed, ...(group.closedTerminals || []).filter(item => item.sessionKey !== closed.sessionKey)].slice(0, 32);
  }

  async function reopenable(groupId) {
    const group = getGroup(groupId);
    if (!group) return [];
    const snapshot = group.savedGroupId
      ? (await state.api.invoke('groups:list')).find(item => item.id === group.savedGroupId)
      : null;
    const members = membersOf(groupId);
    const definitions = new Map(members.map(tab => [tab.sessionKey, describe(tab)]));
    for (const tab of [...(group.closedTerminals || []), ...shellDefinitions(snapshot)]) definitions.set(tab.sessionKey, tab);
    const busy = new Set(members.filter(tab => tab.connected || tab.connecting).map(tab => tab.sessionKey));
    return [...definitions.values()].filter(tab => tab.host && !busy.has(tab.sessionKey));
  }

  async function reopenTerminal(groupId, definition) {
    const group = getGroup(groupId);
    if (!group || state.closingProjects?.has(groupId)) throw new Error('This project has closed.');
    let tab = membersOf(groupId).find(tab => tab.sessionKey === definition.sessionKey);
    const path = definition.initialPath || definition.currentPath;
    if (!tab) {
      if (membersOf(groupId).length >= 32) throw new Error('A project supports up to 32 terminals.');
      const { sessionKey, host, manualTitle, tabColor } = definition;
      tab = tabs.createTabState({ sessionKey, host, manualTitle, tabColor, groupId, currentPath: path, initialPath: path, treeRootPath: path });
      group.closedTerminals = (group.closedTerminals || []).filter(item => item.sessionKey !== tab.sessionKey);
    }
    tabs.setActiveSessionTab(tab.id);
    if (tab.connected || tab.connecting) return true;
    tab.term.reset();
    return tabs.connectTab(tab, definition.host, definition.host === '__local__' ? { cwd: path, path } : { restorePath: path });
  }

  async function save(groupId, update = false) {
    try {
      const group = state.appState.tabGroups.find(item => item.id === groupId);
      if (!group) return;
      const name = update ? group.name : await askForText({ title: 'Save group', value: group.name });
      if (!name) return;
      const library = await state.api.invoke('groups:list');
      const existing = library.filter(item => groupKey(item.name) === groupKey(name))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      const linked = library.find(item => item.id === group.savedGroupId && groupKey(item.name) === groupKey(name));
      const dockLayout = tabs.getDockLayout(groupId);
      const members = membersOf(groupId);
      const activeKeys = new Set(members.map(tab => tab.sessionKey));
      const snapshot = {
        id: linked?.id || existing?.id, kind: 'project', name, layout: group.layout,
        externalEditor: structuredClone(group.externalEditor || linked?.externalEditor || existing?.externalEditor),
        terminalLayout: group.terminalLayout,
        dockLayout: structuredClone(dockLayout),
        configurationIds: [...(group.configurationIds || [])],
        activeIndex: Math.max(0, members.findIndex(tab => tab.id === state.activeTabId)),
        tabs: [...members.map(describe), ...shellDefinitions(linked || existing).filter(tab => !activeKeys.has(tab.sessionKey))]
      };
      const saved = await state.api.invoke('groups:save', snapshot);
      const current = state.appState.tabGroups.find(item => item.id === groupId);
      if (current) current.savedGroupId = saved.id;
      await state.api.updateState({ tabGroups: state.appState.tabGroups });
      window.dispatchEvent(new Event('marinashell:groups-changed'));
    } catch (error) { showError(error); }
  }
  async function restore(snapshot, { focus = true } = {}) {
    const existing = state.appState.tabGroups.find(group => group.savedGroupId === snapshot.id);
    const member = existing && membersOf(existing.id)[0];
    if (member) {
      if (focus) tabs.setActiveSessionTab(member.id);
      return existing;
    }
    const definitions = shellDefinitions(snapshot);
    if (!definitions.length) throw new Error('This project has no saved shell sessions. Open configuration output from Run configurations.');
    const latest = state.appState.projectLayouts?.[snapshot.id];
    const group = Object.assign(existing || { id: crypto.randomUUID() }, { name: snapshot.name, layout: snapshot.layout,
      terminalLayout: snapshot.terminalLayout,
      dockLayout: structuredClone(latest?.dockLayout || snapshot.dockLayout),
      savedGroupId: snapshot.id, configurationIds: [...(snapshot.configurationIds || [])] });
    group.externalEditor = structuredClone(snapshot.externalEditor);
    const restoredKeys = new Set(definitions.map(tab => tab.sessionKey));
    group.closedTerminals = (group.closedTerminals || []).filter(tab => !restoredKeys.has(tab.sessionKey));
    if (!existing) state.appState.tabGroups.push(group);
    const restored = definitions.map(initial => tabs.createTabState({ ...initial, groupId: group.id }));
    const desired = restored.find(tab => tab.sessionKey === latest?.activeSessionKey) || restored[snapshot.activeIndex] || restored[0];
    if (focus && desired) tabs.setActiveSessionTab(desired.id);
    const results = await Promise.allSettled(restored.map(async (tab, index) => {
      const initial = definitions[index];
      if (initial.readOnly) {
        tab.statusMessage = 'Configuration ready — press Run to start';
        tab.term.writeln(tab.statusMessage);
        return;
      }
      if (initial.host) return tabs.connectTab(tab, initial.host, { restorePath: initial.currentPath });
    }));
    for (let index = 0; index < results.length; index++) {
      if (results[index].status === 'rejected') {
        restored[index].statusMessage = results[index].reason?.message || 'Connection failed';
        restored[index].statusIsError = true;
      }
    }
    tabs.renderSessionTabs(); tabs.updateTerminalGrid();
    await state.api.updateState({ tabGroups: state.appState.tabGroups });
    window.dispatchEvent(new CustomEvent('marinashell:groups-changed'));
    return group;
  }
  async function open() {
    const view = modal('Saved groups'); view.dialog.classList.add('saved-groups-dialog');
    view.body.textContent = 'Loading…';
    view.footer.append(button('Close', view.close));
    async function render() {
      try {
        const groups = await state.api.invoke('groups:list');
        view.body.replaceChildren();
        if (!groups.length) view.body.textContent = 'Right-click a group and choose “Save group…” to keep a reusable snapshot.';
        const families = new Map();
        for (const group of groups) {
          const key = groupKey(group.name);
          if (!families.has(key)) families.set(key, []);
          families.get(key).push(group);
        }
        for (const versions of families.values()) {
          versions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          let group = versions[0];
          const row = document.createElement('div'); row.className = 'workspace-library-row';
          const info = document.createElement('div');
          const name = document.createElement('span'); name.textContent = group.name;
          const detail = document.createElement('small');
          const describe = () => { detail.textContent = `${group.tabs.length} ${group.tabs.length === 1 ? 'tab' : 'tabs'} · ${group.terminalLayout ? 'Custom layout' : group.layout || '1x1'}`; };
          describe(); info.append(name, detail);
          if (versions.length > 1) {
            const selector = document.createElement('select'); selector.className = 'saved-group-versions'; selector.setAttribute('aria-label', `Saved versions of ${group.name}`);
            versions.forEach((version, index) => {
              const date = version.updatedAt ? new Date(version.updatedAt).toLocaleString() : 'Undated';
              selector.add(new Option(`${index === 0 ? 'Latest' : 'Previous'} · ${version.tabs.length} tabs · ${date}`, version.id));
            });
            selector.addEventListener('change', () => { group = versions.find(item => item.id === selector.value); describe(); });
            info.append(selector);
          }
          const restoreButton = button('Restore', async () => {
            restoreButton.disabled = true;
            try { await restore(group); view.close(); } catch (error) { showError(error); restoreButton.disabled = false; }
          });
          row.append(info, restoreButton, button('Open in editor…', () => { view.close(); state.externalEditors.openSaved(group); }, 'ghost-btn'), button('Delete', async () => {
            if (!await confirmAction('Delete saved group?', `Delete the selected snapshot of “${group.name}” from the saved library? Open groups are kept.`, 'Delete')) return;
            await state.api.invoke('groups:delete', group.id); await render();
          }, 'ghost-btn'));
          view.body.append(row);
        }
      } catch (error) { view.body.textContent = error.message; }
    }
    await render();
  }
  document.getElementById('saved-groups-btn')?.addEventListener('click', open);
  return { save, restore, open, rememberClosed, reopenable, reopenTerminal };
}
