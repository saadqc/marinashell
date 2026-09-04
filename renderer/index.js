import { createState } from './state.js';
import { createSettingsService } from './services/settingsService.js';
import { createPersistenceService } from './services/persistenceService.js';
import { createEditorService } from './services/editorService.js';
import { createFilesPanel } from './components/filesPanel.js';
import { createActionsPanel } from './components/actionsPanel.js';
import { createSessionTabs } from './components/sessionTabs.js';
import { createPasswordPrompt } from './components/passwordPrompt.js';
import { matchesShortcutEvent } from './utils.js';
import { createDockLayout } from './components/dockLayout.js';
import { createStatusBar } from './components/statusBar.js';

import { createPluginLoader } from './services/pluginLoader.js';

const api = window.api;
const preloadReady = window.preloadReady;

const elements = {
  hostSelect: document.getElementById('host-select'),
  connectButton: document.getElementById('connect-btn'),
  statusLabel: document.getElementById('status'),
  statusTransfer: document.getElementById('status-transfer'),
  statusTransferLabel: document.getElementById('status-transfer-label'),
  statusTransferMeta: document.getElementById('status-transfer-meta'),
  statusTransferFill: document.getElementById('status-transfer-fill'),
  fileTree: document.getElementById('file-tree'),
  commandsList: document.getElementById('commands'),
  transferStatus: document.getElementById('transfer-status'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  sectionHeaders: document.querySelectorAll('.section-header'),
  sessionTabs: document.getElementById('session-tabs'),
  newTabButton: document.getElementById('new-tab-btn'),
  newGroupButton: document.getElementById('new-group-btn'),
  sidebarCollapseButton: document.getElementById('sidebar-collapse-btn'),
  terminalStack: document.getElementById('terminal-stack'),
  dockRoot: document.getElementById('dock-root'),
  viewToolbar: document.getElementById('view-toolbar'),
  statusbar: document.getElementById('statusbar'),
  uploadInput: document.getElementById('upload-file'),
  uploadRemoteInput: document.getElementById('upload-remote'),
  uploadButton: document.getElementById('upload-btn'),
  downloadRemoteInput: document.getElementById('download-remote'),
  downloadButton: document.getElementById('download-btn'),
  commandNameInput: document.getElementById('command-name'),
  commandCwdInput: document.getElementById('command-cwd'),
  commandCommandInput: document.getElementById('command-command'),
  commandSaveButton: document.getElementById('command-save-btn'),
  commandCancelButton: document.getElementById('command-cancel-btn'),
  backButton: document.getElementById('back-btn'),
  forwardButton: document.getElementById('forward-btn'),
  pathInput: document.getElementById('path-input'),
  pathGoButton: document.getElementById('path-go-btn'),
  pathSaveButton: document.getElementById('path-save-btn'),
  savedPaths: document.getElementById('saved-paths'),
  recentPaths: document.getElementById('recent-paths'),
  tunnelTypeSelect: document.getElementById('tunnel-type'),
  tunnelSrcPortInput: document.getElementById('tunnel-src-port'),
  tunnelDstInput: document.getElementById('tunnel-dst'),
  addTunnelButton: document.getElementById('add-tunnel-btn'),
  tunnelsList: document.getElementById('tunnels-list')
};

const state = createState(api, elements);
const settingsService = createSettingsService(state);
const persistenceService = createPersistenceService(state, settingsService);
const editorBridge = { openFile: async () => { } };
const editorModes = new Map();
const actionsBridge = {
  createTransferRow: () => null,
  markTransferComplete: () => { },
  updateTransferRowForTab: () => { }
};
const pluginLoader = createPluginLoader(api);

const filesPanel = createFilesPanel(state, persistenceService, editorBridge, actionsBridge);

const actionsPanel = createActionsPanel(state, persistenceService, filesPanel);
const editorService = createEditorService(state, settingsService, actionsPanel, persistenceService, editorModes);
editorBridge.openFile = editorService.openFile;
actionsBridge.createTransferRow = actionsPanel.createTransferRow;
actionsBridge.markTransferComplete = actionsPanel.markTransferComplete;
actionsBridge.updateTransferRowForTab = actionsPanel.updateTransferRowForTab;
actionsBridge.updateTransferRowTextForTab = actionsPanel.updateTransferRowTextForTab;
const sessionTabs = createSessionTabs(state, persistenceService, filesPanel, actionsPanel, settingsService);
createPasswordPrompt(state);
const statusBar = createStatusBar(state);
const dockLayout = createDockLayout({
  rootEl: elements.dockRoot,
  toolbarEl: elements.viewToolbar,
  sessionTabs,
  terminalStackEl: elements.terminalStack,
  state
});

function setSidebarCollapsed(collapsed, options = {}) {
  const next = Boolean(collapsed);
  const appEl = document.getElementById('app');
  const button = elements.sidebarCollapseButton;
  if (appEl) appEl.classList.toggle('sidebar-collapsed', next);
  if (button) {
    button.title = next ? 'Expand sidebar' : 'Collapse sidebar';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!next));
    button.innerHTML = `<i data-icon="${next ? 'panel-left-open' : 'panel-left-close'}"></i>`;
    renderLucide(button);
  }
  if (state.appState) state.appState.sidebarCollapsed = next;
  if (!options.skipPersist && api) api.updateState({ sidebarCollapsed: next });
  requestAnimationFrame(() => sessionTabs.fitActiveTerminal());
}

if (elements.sidebarCollapseButton) {
  elements.sidebarCollapseButton.addEventListener('click', () => {
    const collapsed = document.getElementById('app').classList.contains('sidebar-collapsed');
    setSidebarCollapsed(!collapsed);
  });
}

function renderLucide(root = document) {
  const lucide = window.lucide;
  if (!lucide || typeof lucide.createIcons !== 'function') return;
  try {
    lucide.createIcons({
      root,
      nameAttr: 'data-icon',
      attrs: { width: '16', height: '16', 'stroke-width': '1.9' }
    });
  } catch (err) { }
}

function reportInitError(error) {
  if (!elements.statusLabel) return;
  const message = error && error.message ? error.message : String(error);
  // Electron does not support `window.prompt()` and may throw a noisy error.
  // Plugins should not rely on it; treat it as non-fatal so it doesn't hijack the status bar.
  if (/prompt\(\)\s+is\s+and\s+will\s+not\s+be\s+supported/i.test(message)) {
    console.warn('[marinashell] Ignoring prompt() unsupported error:', message);
    return;
  }
  elements.statusLabel.textContent = `Init error: ${message}`;
  elements.statusLabel.classList.add('error');
}

window.addEventListener('error', (event) => {
  reportInitError(event.error || event.message || 'Unknown error');
});

window.addEventListener('unhandledrejection', (event) => {
  reportInitError(event.reason || 'Unhandled promise rejection');
});

window.addEventListener('focus', async () => {
  if (!api) return;
  try {
    const settings = await api.getSettings();
    if (settings) {
      state.appSettings = settings;
      settingsService.applySettings({
        reconcileTabs: true,
        onReconcileTabs: () => persistenceService.persistTabs({ forceClear: true }),
        onTreeUpdate: () => filesPanel.renderTree()
      });
      state.shortcutBindings = settingsService.getShortcutBindings();
      sessionTabs.renderSessionTabs();
      sessionTabs.updateTerminalGrid();
    }
  } catch (err) {
  }
});

if (elements.statusLabel) {
  elements.statusLabel.textContent = 'Renderer starting...';
  elements.statusLabel.classList.remove('error');
}

if (!window.Terminal || !window.FitAddon) {
  reportInitError('xterm failed to load');
}

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  const bindings = state.shortcutBindings || {};
  if (matchesShortcutEvent(event, bindings.newTab)) {
    event.preventDefault();
    sessionTabs.createNewTab();
    return;
  }
  if (matchesShortcutEvent(event, bindings.closeTab)) {
    event.preventDefault();
    sessionTabs.closeActiveTab();
  }
});

window.addEventListener('marinashell:open-terminal-tab', async (event) => {
  const detail = event && event.detail ? event.detail : {};
  const host = detail && detail.host ? String(detail.host) : '';
  const command = detail && detail.command ? String(detail.command) : '';
  const path = detail && detail.path ? String(detail.path) : '/';
  const detached = Boolean(detail && detail.detached);
  if (!host) return;
  try {
    try {
      if (detached) {
        const leaf = dockLayout.getActiveLeaf ? dockLayout.getActiveLeaf() : null;
        if (leaf && leaf.viewId !== 'terminal') {
          dockLayout.splitVertical();
        }
      }
      dockLayout.mountViewInActive('terminal');
    } catch (err) { }
    const tab = sessionTabs.createNewTab({ host, path, connect: false });
    try { sessionTabs.setActiveSessionTab(tab.id); } catch (err) { }
    const ok = await sessionTabs.connectTab(tab, host, { restorePath: path });
    if (ok && command) {
      api.write(tab.id, `${command}\n`);
    }
    try { dockLayout.mountViewInActive('terminal'); } catch (err) { }
  } catch (err) {
    // Best-effort only; status UI will show connection errors in the new tab.
  }
});

window.addEventListener('marinashell:focus-terminal', () => {
  try { dockLayout.mountViewInActive('terminal'); } catch (err) { }
  try { sessionTabs.fitActiveTerminal(); } catch (err) { }
});

window.addEventListener('marinashell:detach-terminal', () => {
  try {
    const leaf = dockLayout.getActiveLeaf ? dockLayout.getActiveLeaf() : null;
    if (leaf && leaf.viewId !== 'terminal') {
      dockLayout.splitVertical();
    }
    dockLayout.mountViewInActive('terminal');
  } catch (err) { }
  try { sessionTabs.fitActiveTerminal(); } catch (err) { }
});

(async function init() {
  if (!api) {
    reportInitError('IPC unavailable');
    return;
  }
  if (!preloadReady) {
    reportInitError('Preload did not run');
    return;
  }
  // Apply plugin enable/disable immediately by reloading the renderer when settings change.
  if (typeof api.onPluginsChanged === 'function') {
    let reloadTimer = null;
    api.onPluginsChanged(() => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try { window.location.reload(); } catch (err) { }
      }, 150);
    });
  }
  try {
    persistenceService.setStatus('Loading SSH hosts...');
    const stateResult = await api.getState();
    const settings = await api.getSettings();
    state.appState = {
      knownHosts: [],
      lastHost: '',
      recentLocations: {},
      savedLocations: {},
      commands: [],
      tabs: [],
      activeTabId: '',
      tabGroups: [],
      sidebarCollapsed: false,
      ...(stateResult || {})
    };
    setSidebarCollapsed(state.appState.sidebarCollapsed, { skipPersist: true });
    state.appSettings = settings || {};

    settingsService.applySettings({
      reconcileTabs: true,
      onReconcileTabs: () => persistenceService.persistTabs({ forceClear: true })
    });
    state.shortcutBindings = settingsService.getShortcutBindings();

    await sessionTabs.refreshHosts();
    actionsPanel.renderCommands(state.appState ? state.appState.commands : []);
    Object.keys(state.sectionState).forEach((key) => filesPanel.updateSectionUI(key));
    sessionTabs.setupTerminalHandlers();
    statusBar.bind();

    const restore = settingsService.shouldRestoreTabs();
    const savedTabs = restore && Array.isArray(state.appState.tabs) ? state.appState.tabs : [];
    const reconnectQueue = [];

    if (savedTabs.length) {
      for (const saved of savedTabs) {
        const tab = sessionTabs.createTabState(saved);
        if (saved.connected && saved.host) {
          reconnectQueue.push({ tab, host: saved.host, path: saved.currentPath || '/' });
        }
      }
      const desiredActive = state.appState.activeTabId && state.tabs.has(state.appState.activeTabId)
        ? state.appState.activeTabId
        : state.tabs.keys().next().value;
      if (desiredActive) {
        sessionTabs.setActiveSessionTab(desiredActive, { skipPersist: true });
      }
    } else {
      const tab = sessionTabs.createTabState({ host: persistenceService.getDefaultHost(state.hostConfigs, elements.hostSelect, state.appState.lastHost) });
      sessionTabs.setActiveSessionTab(tab.id, { skipPersist: true });
      if (state.appState.lastHost && !tab.host) {
        tab.host = state.appState.lastHost;
      }
    }

    for (const item of reconnectQueue) {
      sessionTabs.connectTab(item.tab, item.host, { restorePath: item.path });
    }

    filesPanel.updateNavButtons();
    statusBar.render();
    renderLucide(document);

    // Plugin Context
    const pluginContext = {
      api,
      state,
      registerCommand: async (name, callback) => {
        // Simple command registration (could be enhanced)
        console.log(`[Plugin] Registered command: ${name}`);
        // For now, we don't have a command palette, but plugins can do custom logic
      },
      registerView: (id, info) => {
        dockLayout.registerView(id, info);
      },
      openView: (id, options) => {
        dockLayout.mountViewInActive(id, options);
      },
      registerEditorMode: (id, handler) => {
        if (!id || typeof handler !== 'function') return;
        editorModes.set(id, handler);
      },
      registerTerminalAction: (id, info) => {
        dockLayout.registerTerminalAction(id, info);
      },
      registerTab: (id, label, renderCallback) => {
        // 1. Create button
        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        btn.dataset.tab = id;
        btn.textContent = label;
        btn.addEventListener('click', () => {
          sessionTabs.setSidebarTab(id);
        });
        document.getElementById('tabs').appendChild(btn);

        // 2. Create panel
        const panel = document.createElement('div');
        panel.id = `tab-${id}`;
        panel.className = 'tab-panel';
        document.getElementById('tab-panels').appendChild(panel);

        // 3. Update selectors logic (hacky but works for now to include new elements)
        // We need to re-query or update the lists in sessionTabs if it caches them.
        // sessionTabs.setSidebarTab uses document.querySelectorAll('.tab-btn'), so it should be fine if called dynamically,
        // BUT sessionTabs.js might need a refresh of its internal lists if it caches them.
        // Actually sessionTabs.js uses `tabButtons` from `elements` which is static at init.
        // We probably need to update that list or handle switching here.

        // Let's monkey-patch usage or just handle it manually here for the new tab
        // Re-bind click on this new button is already done above.
        // But we need to update the "setSidebarTab" logic to know about this new button/panel
        // if it iterates over a fixed list.

        // Let's update the global elements reference if possible, or just rely on the class toggling logic
        // which we can duplicate or expose.

        // Expose setSidebarTab to context or just duplicate logic:
        // Actually, sessionTabs.js doesn't export setSidebarTab directly in a way we can easily patch without re-creating.
        // But we can just implement the switching logic for this tab here.

        // Actually, let's look at `sessionTabs.setSidebarTab`. It queries `tabButtons` which is from `elements`.
        // `elements` is passed to createSessionTabs.
        // If we want `setSidebarTab` to work for new tabs, we need to update the `elements.tabButtons` NodeList 
        // or make `setSidebarTab` re-query.
        // Since `elements` sends static NodeLists, we might have an issue.

        // Strategy: We will re-query and toggle classes manually in this event listener
        // ensuring we also deselect others.

        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
          document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));
        });

        // 4. Render
        if (typeof renderCallback === 'function') {
          renderCallback(panel);
        }
      }
    };

    await pluginLoader.loadPlugins(pluginContext);
    renderLucide(document);

  } catch (err) {
    reportInitError(err);
  }
})();
