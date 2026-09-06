import { modal, button, confirmAction, showError } from './dialog.js';

export function createSavedGroups(state, tabs, askForText, getLabel) {
  async function save(groupId, update = false) {
    try {
      const group = state.appState.tabGroups.find(item => item.id === groupId);
      if (!group) return;
      const name = update ? group.name : await askForText({ title: 'Save group', value: group.name });
      if (!name) return;
      const members = [...state.tabs.values()].filter(tab => tab.groupId === groupId);
      const snapshot = {
        id: update ? group.savedGroupId : undefined, name, layout: group.layout,
        configurationIds: [...(group.configurationIds || [])],
        activeIndex: Math.max(0, members.findIndex(tab => tab.id === state.activeTabId)),
        tabs: members.map(tab => ({
          host: tab.host, currentPath: tab.currentPath, treeRootPath: tab.treeRootPath,
          manualTitle: tab.manualTitle || getLabel(tab), tabColor: tab.tabColor,
          connected: tab.connected, configurationId: tab.configurationId || '', readOnly: Boolean(tab.readOnly)
        }))
      };
      const saved = await state.api.invoke('groups:save', snapshot);
      group.savedGroupId = saved.id;
      await state.api.updateState({ tabGroups: state.appState.tabGroups });
    } catch (error) { showError(error); }
  }
  async function restore(snapshot) {
    const group = { id: crypto.randomUUID(), name: snapshot.name, layout: snapshot.layout,
      savedGroupId: snapshot.id, configurationIds: [...(snapshot.configurationIds || [])] };
    state.appState.tabGroups.push(group);
    const restored = [];
    for (const initial of snapshot.tabs) {
      const tab = tabs.createTabState({ ...initial, groupId: group.id });
      restored.push(tab);
      if (initial.readOnly) {
        tab.statusMessage = 'Configuration ready — press Run to start';
        tab.term.writeln(tab.statusMessage);
      } else if (initial.connected && initial.host) {
        await tabs.connectTab(tab, initial.host, { restorePath: initial.currentPath });
      }
    }
    if (restored.length) tabs.setActiveSessionTab(restored[snapshot.activeIndex]?.id || restored[0].id);
    tabs.renderSessionTabs(); tabs.updateTerminalGrid();
    await state.api.updateState({ tabGroups: state.appState.tabGroups });
    window.dispatchEvent(new CustomEvent('marinashell:groups-changed'));
    return group;
  }
  async function open() {
    const view = modal('Saved groups');
    view.body.textContent = 'Loading…';
    view.footer.append(button('Close', view.close));
    async function render() {
      try {
        const groups = await state.api.invoke('groups:list');
        view.body.replaceChildren();
        if (!groups.length) view.body.textContent = 'Right-click a group and choose “Save group…” to keep a reusable snapshot.';
        for (const group of groups) {
          const row = document.createElement('div'); row.className = 'workspace-library-row';
          const info = document.createElement('div'); info.textContent = group.name;
          const detail = document.createElement('small'); detail.textContent = `${group.tabs.length} tabs · ${group.layout || '1x1'}`; info.append(detail);
          const restoreButton = button('Restore', async () => {
            restoreButton.disabled = true;
            try { await restore(group); view.close(); } catch (error) { showError(error); restoreButton.disabled = false; }
          });
          row.append(info, restoreButton, button('Delete', async () => {
            if (!await confirmAction('Delete saved group?', `Delete “${group.name}” from the saved library? Open groups are kept.`, 'Delete')) return;
            await state.api.invoke('groups:delete', group.id); await render();
          }, 'ghost-btn'));
          view.body.append(row);
        }
      } catch (error) { view.body.textContent = error.message; }
    }
    await render();
  }
  document.getElementById('saved-groups-btn')?.addEventListener('click', open);
  return { save, restore, open };
}
