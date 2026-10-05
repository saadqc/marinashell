import { getActiveTab } from '../state.js';

export function createPersistenceService(state, settingsService) {
  let saving = Promise.resolve();
  let saveRevision = 0;
  const notifySave = detail => window.dispatchEvent(new CustomEvent('marinashell:layout-save-state', { detail }));
  function getHostState(map, host) {
    if (!map || !host) {
      return [];
    }
    return Array.isArray(map[host]) ? map[host] : [];
  }

  function updateHostState(key, host, list) {
    if (!state.appState || !host) {
      return;
    }
    const nextMap = { ...(state.appState[key] || {}) };
    nextMap[host] = list;
    state.appState = { ...state.appState, [key]: nextMap };
    state.api.updateState({ [key]: nextMap });
  }

  // Run only after every restored tab has been materialized.
  function reconcileGroups() {
    const groups = Array.isArray(state.appState.tabGroups) ? state.appState.tabGroups : [];
    const referenced = new Set([...state.tabs.values()].map(tab => tab.groupId).filter(Boolean));
    const retained = new Map();
    for (const group of groups) {
      if (group && typeof group.id === 'string' && referenced.has(group.id) && !retained.has(group.id)) {
        retained.set(group.id, group);
      }
    }
    let repaired = 0;
    for (const tab of state.tabs.values()) {
      if (tab.groupId && !retained.has(tab.groupId)) { tab.groupId = ''; repaired++; }
    }
    state.appState.tabGroups = [...retained.values()];
    return { removed: groups.length - retained.size, repaired };
  }

  function persistTabs(options = {}) {
    if (!state.appState || !state.api) {
      return;
    }
    if (state.workspaceReady) reconcileGroups();
    const tabGroups = Array.isArray(state.appState.tabGroups) ? state.appState.tabGroups : [];
    const restoreTabs = settingsService.shouldRestoreTabs() && !options.forceClear;
    const serialized = (restoreTabs ? Array.from(state.tabs.values()).filter(tab => !tab.readOnly) : []).map((tab) => ({
      id: tab.id,
      sessionKey: tab.sessionKey,
      host: tab.host || '',
      currentPath: tab.currentPath || '/',
      treeRootPath: tab.treeRootPath || '/',
      connected: Boolean(tab.connected),
      manualTitle: tab.manualTitle || '',
      tabColor: tab.tabColor || 'default',
      groupId: tab.groupId || '',
      readOnly: Boolean(tab.readOnly),
      configurationId: tab.configurationId || '',
      runId: tab.runId || ''
    }));
    const activeId = serialized.some(tab => tab.id === state.activeTabId) ? state.activeTabId : serialized[0]?.id || '';
    const projectLayouts = { ...(state.appState.projectLayouts || {}) };
    for (const group of tabGroups) {
      // Settings may clear launch tabs before sessions exist. Keep saved layouts.
      if (!state.workspaceReady) continue;
      if (state.closingProjects?.has(group.id)) continue;
      if (!group.dockLayout) continue;
      const keys = [...state.tabs.values()].filter(tab => !tab.readOnly && tab.groupId === group.id).map(tab => tab.sessionKey);
      group.dockLayout = globalThis.MarinaDocking.reconcile(group.dockLayout, keys);
      projectLayouts[group.savedGroupId || group.id] = { dockLayout: structuredClone(group.dockLayout), activeSessionKey: state.tabs.get(group.lastActiveTabId)?.sessionKey || '', updatedAt: new Date().toISOString() };
    }
    const patch = structuredClone({ tabs: serialized, activeTabId: activeId, tabGroups, projectLayouts, scratchDockLayout: state.appState.scratchDockLayout });
    state.appState = { ...state.appState, ...patch };
    const revision = ++saveRevision;
    notifySave({ status: 'saving' });
    saving = saving.catch(() => {}).then(() => state.api.updateState(patch)).then(() => {
      if (revision === saveRevision) notifySave({ status: 'saved' });
      return true;
    }).catch(error => {
      if (revision === saveRevision) notifySave({ status: 'error', error: error.message });
      return false;
    });
    return saving;
  }

  function getDefaultHost(hostConfigs, hostSelect, lastHost) {
    if (lastHost && hostConfigs.has(lastHost)) {
      return lastHost;
    }
    const first = hostSelect && hostSelect.options.length > 0 ? hostSelect.options[0] : null;
    return first ? first.value : '';
  }

  function setStatus(text, isError, tab = getActiveTab(state)) {
    if (!tab) return;
    tab.statusMessage = text;
    tab.statusIsError = Boolean(isError);
    const statusLabel = state.elements.statusLabel;
    if (tab.id === state.activeTabId && statusLabel) {
      statusLabel.textContent = text;
      statusLabel.classList.toggle('error', Boolean(isError));
    }
  }

  function getTunnelProfiles(host) {
    if (!state.appState || !state.appState.tunnelProfiles || !host) {
      return [];
    }
    return Array.isArray(state.appState.tunnelProfiles[host]) ? state.appState.tunnelProfiles[host] : [];
  }

  function saveTunnelProfiles(host, profiles) {
    if (!state.appState || !host) return;
    const nextMap = { ...(state.appState.tunnelProfiles || {}) };
    nextMap[host] = profiles;
    state.appState = { ...state.appState, tunnelProfiles: nextMap };
    state.api.updateState({ tunnelProfiles: nextMap });
  }

  return {
    getHostState,
    updateHostState,
    persistTabs,
    reconcileGroups,
    getDefaultHost,
    setStatus,
    getTunnelProfiles,
    saveTunnelProfiles
  };
}
