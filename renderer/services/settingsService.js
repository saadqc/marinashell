import { parseShortcut } from '../utils.js';

export function createSettingsService(state) {
  function readSettingValue(category, subcategory, field, fallback) {
    const node = state.appSettings && state.appSettings[category] && state.appSettings[category][subcategory]
      ? state.appSettings[category][subcategory][field]
      : null;
    if (node && Object.prototype.hasOwnProperty.call(node, 'value')) {
      return node.value;
    }
    return fallback;
  }

  function readSettingList(category, subcategory, field) {
    const value = readSettingValue(category, subcategory, field, []);
    return Array.isArray(value) ? value : [];
  }

  function shouldRestoreTabs() {
    return Boolean(readSettingValue('ui', 'session', 'restoreTabs', false));
  }

  function applySettings(options = {}) {
    const pageSize = Number(readSettingValue('ui', 'tree', 'pageSize', 500));
    if (!Number.isNaN(pageSize)) {
      state.treePageSize = Math.max(100, Math.min(2000, pageSize));
    }
    if (options.onTreeUpdate) {
      options.onTreeUpdate();
    }
    const restoreTabs = shouldRestoreTabs();
    if (options.reconcileTabs && !restoreTabs && typeof options.onReconcileTabs === 'function') {
      options.onReconcileTabs();
    }
  }

  function getEditorSettings() {
    return {
      mode: readSettingValue('editor', 'open', 'mode', 'remote-shell'),
      commandTemplate: readSettingValue('editor', 'open', 'commandTemplate', 'nano {escapedPath}'),
      localCommandTemplate: readSettingValue('editor', 'open', 'localCommandTemplate', 'code --reuse-window {path}'),
      sftpUriTemplate: readSettingValue('editor', 'open', 'sftpUriTemplate', 'sftp://{user}@{host}:{port}{path}'),
      associations: readSettingList('editor', 'associations', 'list')
    };
  }

  function getShortcutBindings() {
    const isMac = navigator.platform && navigator.platform.toLowerCase().includes('mac');
    const defaults = { newTab: 'mod+alt+t', selectEditor: 'mod+e', selectTerminal: 'mod+t', closeTab: 'mod+w', nextTab: 'mod+tab', previousTab: 'mod+shift+tab', search: 'mod+k',
      ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab${i + 1}`, `mod+${i + 1}`])) };
    const bindings = Object.fromEntries(Object.entries(defaults).map(([name, fallback]) =>
      [name, parseShortcut(readSettingValue('ui', 'shortcuts', name, fallback), isMac)]));
    // Cmd+Tab belongs to the macOS app switcher. Keep Control+Tab available
    // while the default binding is selected; a custom/blank binding replaces it.
    if (isMac) for (const name of ['nextTab', 'previousTab']) {
      if (matchesDefault(bindings[name], parseShortcut(defaults[name], true)))
        bindings[`${name}Mac`] = parseShortcut(defaults[name].replace('mod+', 'ctrl+'), true);
    }
    return bindings;
  }

  function matchesDefault(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function shouldAutoConnectOnSelect() {
    return Boolean(readSettingValue('ui', 'connection', 'autoConnectOnSelect', false));
  }

  function shouldAutoStartTunnels() {
    return Boolean(readSettingValue('ui', 'connection', 'autoStartTunnels', true));
  }

  return {
    readSettingValue,
    readSettingList,
    applySettings,
    shouldRestoreTabs,
    getEditorSettings,
    getShortcutBindings,
    shouldAutoConnectOnSelect,
    shouldAutoStartTunnels
  };
}
