import { modal, button, showError } from './dialog.js';

export function createWorkspaceNavigation({ state, sessionTabs, dockLayout, setSidebarCollapsed, projects }) {
  const commands = new Map();
  let palette = null;
  const searchButton = document.getElementById('command-search');
  function updateShortcutHint() {
    const binding = state.shortcutBindings?.search;
    const parts = binding ? [binding.meta && '⌘', binding.ctrl && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', binding.key.toUpperCase()].filter(Boolean) : [];
    searchButton.querySelector('kbd').textContent = parts.join(' ');
    searchButton.querySelector('kbd').hidden = !binding;
    searchButton.title = `Search commands and sessions${parts.length ? ` (${parts.join('+')})` : ''}`;
  }
  window.addEventListener('marinashell:shortcuts-changed', updateShortcutHint);
  const registerCommand = (name, callback) => {
    if (typeof callback === 'function') commands.set(name, callback);
  };
  const openSettings = () => state.api.openSettings().catch(showError);
  const openTerminal = () => {
    document.querySelector('#tool-navigation [data-view="terminal"]')?.click();
  };
  registerCommand('New terminal session', () => { sessionTabs.createNewTab(); openTerminal(); });
  registerCommand('New local terminal', () => { sessionTabs.createNewTab({ host: '__local__', connect: true }); openTerminal(); });
  registerCommand('New project', () => projects.editProject());
  registerCommand('Connect to SSH or local shell', () => projects.openConnect());
  registerCommand('Project settings', () => projects.options());
  registerCommand('Open project', () => projects.openLibrary());
  registerCommand('Browse files', () => { setSidebarCollapsed(false); sessionTabs.setSidebarTab('files'); });
  registerCommand('Toggle sidebar', () => setSidebarCollapsed(!document.getElementById('app').classList.contains('sidebar-collapsed')));
  registerCommand('Split pane right', () => dockLayout.splitVertical());
  registerCommand('Split pane down', () => dockLayout.splitHorizontal());
  registerCommand('Single pane layout', () => dockLayout.resetLayout());
  registerCommand('Open settings', openSettings);

  function entries() {
    const result = [...commands].map(([name, action]) => ({ name, action, category: 'Command' }));
    for (const view of dockLayout.getViews()) {
      const control = [...document.querySelectorAll('#tool-navigation [data-view]')].find(el => el.dataset.view === view.id);
      result.push({ name: `Open ${view.title}`, category: control?.disabled ? 'Connect a supported session first' : 'Tool', disabled: control?.disabled,
        action: () => control?.click() });
    }
    for (const tab of state.tabs.values()) {
      if (tab.runOutput) continue;
      result.push({ name: tab.manualTitle || tab.terminalTitle || (tab.host === '__local__' ? 'Local terminal' : tab.host) || 'New session',
        category: 'Session', action: () => { sessionTabs.setActiveSessionTab(tab.id); openTerminal(); } });
    }
    return result;
  }

  function openPalette() {
    if (palette || document.querySelector('dialog[open]')) return;
    const view = modal('Jump to a session or command'); palette = view;
    view.dialog.classList.add('command-palette');
    view.dialog.addEventListener('close', () => { palette = null; });
    const input = document.createElement('input'); input.placeholder = 'Search sessions, tools, and commands…';
    input.setAttribute('aria-label', 'Search sessions, tools, and commands');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'command-results'); input.setAttribute('aria-autocomplete', 'list');
    const list = document.createElement('div'); list.id = 'command-results'; list.setAttribute('role', 'listbox');
    view.body.append(input, list);
    const help = document.createElement('span'); help.textContent = '↑ ↓ Navigate   ↵ Open   Esc Close'; view.footer.append(help);
    let selected = 0, filtered = [];
    async function choose(index) {
      const entry = filtered[index];
      if (!entry || entry.disabled) return;
      view.close();
      try { await entry.action(); } catch (error) { showError(error); }
    }
    function highlight() {
      [...list.children].forEach((row, index) => {
        row.classList.toggle('selected', index === selected);
        row.setAttribute('aria-selected', String(index === selected));
      });
      if (filtered.length) {
        input.setAttribute('aria-activedescendant', `command-result-${selected}`);
        list.children[selected]?.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      const terms = input.value.toLocaleLowerCase().trim().split(/\s+/);
      filtered = entries().filter(entry => terms.every(term => `${entry.name} ${entry.category}`.toLocaleLowerCase().includes(term)));
      selected = 0; list.replaceChildren();
      filtered.forEach((entry, index) => {
        const row = button('', () => choose(index), 'command-result'); row.id = `command-result-${index}`;
        row.setAttribute('role', 'option'); row.tabIndex = -1; row.disabled = Boolean(entry.disabled);
        const label = document.createElement('span'); label.textContent = entry.name;
        const category = document.createElement('small'); category.textContent = entry.category;
        row.append(label, category); list.append(row);
      });
      if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'command-empty'; empty.textContent = 'No matching sessions or commands. Try a tool name, such as Terminal.'; list.append(empty); }
      highlight();
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selected = Math.max(0, Math.min(filtered.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); highlight();
      } else if (event.key === 'Enter') { event.preventDefault(); choose(selected); }
    });
    render(); input.focus();
  }

  async function openExtensions() {
    const view = modal('Extensions'); view.dialog.classList.add('extensions-dialog');
    view.body.textContent = 'Loading installed extensions…';
    view.footer.append(button('Close', view.close, 'ghost-btn'), button('Manage in settings', () => { view.close(); openSettings(); }));
    try {
      const plugins = await state.api.getPlugins(); view.body.replaceChildren();
      const intro = document.createElement('p'); intro.className = 'extensions-intro';
      intro.textContent = 'Tools appear in the left rail. Terminal actions appear in the pane header. Enable, disable, or install extensions in Settings.';
      view.body.append(intro);
      for (const plugin of plugins) {
        const row = document.createElement('div'); row.className = 'extension-row';
        const info = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = plugin.name || plugin.id;
        const description = document.createElement('small'); description.textContent = plugin.error || plugin.description || 'Workspace extension';
        info.append(name, description);
        const status = document.createElement('span'); status.className = 'extension-status';
        status.textContent = plugin.error ? 'Error' : plugin.enabled === false ? 'Disabled' : 'Enabled';
        row.append(info, status); view.body.append(row);
      }
      if (!plugins.length) view.body.append('No extensions installed. Add one from Settings.');
    } catch (error) { view.body.textContent = `Unable to load extensions: ${error.message}`; }
  }
  registerCommand('Browse extensions', openExtensions);
  searchButton.addEventListener('click', openPalette);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('extensions-btn').addEventListener('click', openExtensions);
  return { registerCommand, openPalette };
}
