import { createSavedGroups } from './savedGroups.js';
import { showError } from './dialog.js';
import { getActiveTab, getTab } from '../state.js';
import { buildRemoteCdCommand, findTerminalLinks, formatRemotePath, getPathLabel, interpolateTabTitle } from '../utils.js';
import { LOCAL_HOST_VALUE, LOCAL_HOST_LABEL } from '../constants.js';

const DEFAULT_TAB_TITLE_TEMPLATE = '<ssh_machine>:<current_folder_name[:15]>';
const GROUP_LAYOUTS = [
  { id: '1x1', label: '1 × 1', columns: 1, rows: 1 },
  { id: '2x1', label: '2 × 1', columns: 2, rows: 1 },
  { id: '1x2', label: '1 × 2', columns: 1, rows: 2 },
  { id: '2x2', label: '2 × 2', columns: 2, rows: 2 }
];
const TAB_COLORS = [
  { id: 'default', label: 'Default' },
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
  { id: 'amber', label: 'Amber' },
  { id: 'red', label: 'Red' },
  { id: 'purple', label: 'Purple' },
  { id: 'slate', label: 'Slate' }
];

export function createSessionTabs(state, persistenceService, filesPanel, actionsPanel, settingsService) {
  const {
    hostSelect,
    connectButton,
    statusLabel,
    sessionTabs,
    newTabButton,
    newGroupButton,
    terminalStack,
    tabButtons,
    tabPanels
  } = state.elements;

  const TerminalCtor = window.Terminal;
  const FitAddonCtor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon);

  const tabContextMenu = document.createElement('div');
  tabContextMenu.className = 'context-menu';
  document.body.appendChild(tabContextMenu);

  const terminalContextMenu = document.createElement('div');
  terminalContextMenu.className = 'context-menu';
  document.body.appendChild(terminalContextMenu);

  const textDialog = document.createElement('div');
  textDialog.className = 'modal session-text-dialog';
  textDialog.setAttribute('aria-hidden', 'true');
  textDialog.innerHTML = `
    <form class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-title" data-dialog-title></div>
      <label class="modal-field">
        <span data-dialog-label>Name</span>
        <input data-dialog-input type="text" autocomplete="off" />
      </label>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" data-dialog-cancel>Cancel</button>
        <button type="submit" data-dialog-submit>Save</button>
      </div>
    </form>
  `;
  document.body.appendChild(textDialog);

  function askForText({ title, label = 'Name', value = '', submitLabel = 'Save' }) {
    return new Promise((resolve) => {
      const form = textDialog.querySelector('form');
      const input = textDialog.querySelector('[data-dialog-input]');
      const cancel = textDialog.querySelector('[data-dialog-cancel]');
      textDialog.querySelector('[data-dialog-title]').textContent = title;
      textDialog.querySelector('[data-dialog-label]').textContent = label;
      textDialog.querySelector('[data-dialog-submit]').textContent = submitLabel;
      input.value = value;
      textDialog.classList.add('open');
      textDialog.setAttribute('aria-hidden', 'false');

      const finish = (result) => {
        form.removeEventListener('submit', onSubmit);
        cancel.removeEventListener('click', onCancel);
        textDialog.removeEventListener('click', onBackdrop);
        window.removeEventListener('keydown', onKeydown, true);
        textDialog.classList.remove('open');
        textDialog.setAttribute('aria-hidden', 'true');
        resolve(result);
      };
      const onSubmit = (event) => {
        event.preventDefault();
        finish(String(input.value || '').trim());
      };
      const onCancel = () => finish(null);
      const onBackdrop = (event) => {
        if (event.target === textDialog) finish(null);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      };
      form.addEventListener('submit', onSubmit);
      cancel.addEventListener('click', onCancel);
      textDialog.addEventListener('click', onBackdrop);
      window.addEventListener('keydown', onKeydown, true);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  function renderLucide(root) {
    const lucide = window.lucide;
    if (!lucide || typeof lucide.createIcons !== 'function') return;
    try {
      lucide.createIcons({
        root: root || document,
        nameAttr: 'data-icon',
        attrs: { width: '14', height: '14', 'stroke-width': '2.1' }
      });
    } catch (err) { }
  }

  function hideTabContextMenu() {
    tabContextMenu.classList.remove('open');
    tabContextMenu.innerHTML = '';
  }

  function hideTerminalContextMenu() {
    terminalContextMenu.classList.remove('open');
    terminalContextMenu.innerHTML = '';
  }

  function getTabGroups() {
    if (!state.appState) return [];
    if (!Array.isArray(state.appState.tabGroups)) {
      state.appState.tabGroups = [];
    }
    return state.appState.tabGroups;
  }

  function getTabGroup(groupId) {
    return groupId ? getTabGroups().find((group) => group.id === groupId) || null : null;
  }

  function persistGroups() {
    if (!state.appState || !state.api) return;
    state.api.updateState({ tabGroups: getTabGroups() });
    persistenceService.persistTabs();
  }

  function addMenuButton(menu, label, onClick, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (options.checked) button.classList.add('checked');
    if (options.danger) button.classList.add('danger');
    button.addEventListener('click', onClick);
    menu.appendChild(button);
    return button;
  }

  function addMenuLabel(menu, label) {
    const el = document.createElement('div');
    el.className = 'context-menu-label';
    el.textContent = label;
    menu.appendChild(el);
  }

  function addColorMenuButton(menu, color, selected, onClick) {
    const button = addMenuButton(menu, color.label, onClick, { checked: selected });
    button.classList.add('color-menu-item');
    const swatch = document.createElement('span');
    swatch.className = `tab-color-swatch tab-color-${color.id}`;
    button.prepend(swatch);
    return button;
  }

  function positionContextMenu(menu, x, y) {
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    menu.classList.add('open');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }

  function openExternalTarget(tab, uri) {
    Promise.resolve(state.api.openExternal(uri)).then((result) => {
      if (result && result.ok === false) {
        persistenceService.setStatus(result.error || 'Could not open link', true, tab);
      }
    }).catch(() => {
      persistenceService.setStatus('Could not open link', true, tab);
    });
  }

  async function renameTab(tabId) {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    const current = tab.manualTitle || getSessionTabLabel(tab);
    const title = await askForText({ title: 'Rename tab', label: 'Tab title', value: current });
    if (title === null) return;
    tab.manualTitle = title;
    renderSessionTabs();
    updateTerminalGrid();
    persistenceService.persistTabs();
  }

  async function createGroup(tabId) {
    const tab = state.tabs.get(tabId);
    if (!tab) return null;
    const folderName = getPathLabel(tab.currentPath, tab.remotePathStyle);
    const name = await askForText({
      title: 'Create tab group',
      label: 'Group name',
      value: folderName === '/' ? '' : folderName,
      submitLabel: 'Create'
    });
    if (!name) return null;
    const group = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      layout: '1x1'
    };
    const previousGroupId = tab.groupId || '';
    getTabGroups().push(group);
    tab.groupId = group.id;
    if (previousGroupId && !Array.from(state.tabs.values()).some((item) => item.groupId === previousGroupId)) {
      state.appState.tabGroups = getTabGroups().filter((item) => item.id !== previousGroupId);
    }
    renderSessionTabs();
    updateTerminalGrid();
    persistGroups();
    return group;
  }

  async function renameGroup(groupId) {
    const group = getTabGroup(groupId);
    if (!group) return;
    const name = await askForText({ title: 'Rename group', label: 'Group name', value: group.name || '' });
    if (!name) return;
    group.name = name;
    renderSessionTabs();
    persistGroups();
  }

  function moveTabToGroup(tabId, groupId) {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    const previousGroupId = tab.groupId || '';
    tab.groupId = groupId || '';
    if (previousGroupId && previousGroupId !== groupId && !Array.from(state.tabs.values()).some((item) => item.groupId === previousGroupId)) {
      state.appState.tabGroups = getTabGroups().filter((group) => group.id !== previousGroupId);
    }
    renderSessionTabs();
    updateTerminalGrid();
    persistGroups();
  }

  function dissolveGroup(groupId) {
    state.tabs.forEach((tab) => {
      if (tab.groupId === groupId) tab.groupId = '';
    });
    state.appState.tabGroups = getTabGroups().filter((group) => group.id !== groupId);
    renderSessionTabs();
    updateTerminalGrid();
    persistGroups();
  }

  function setGroupLayout(groupId, layoutId) {
    const group = getTabGroup(groupId);
    if (!group || !GROUP_LAYOUTS.some((layout) => layout.id === layoutId)) return;
    group.layout = layoutId;
    renderSessionTabs();
    updateTerminalGrid();
    persistGroups();
  }

  function setTabColor(tabId, colorId) {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    tab.tabColor = TAB_COLORS.some((color) => color.id === colorId) ? colorId : 'default';
    renderSessionTabs();
    persistenceService.persistTabs();
  }

  function showTabContextMenu(x, y, tabId) {
    tabContextMenu.innerHTML = '';
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    addMenuButton(tabContextMenu, 'Rename tab…', () => {
      hideTabContextMenu();
      renameTab(tabId);
    });
    if (tab.manualTitle) {
      addMenuButton(tabContextMenu, 'Use automatic title', () => {
        tab.manualTitle = '';
        hideTabContextMenu();
        renderSessionTabs();
        updateTerminalGrid();
        persistenceService.persistTabs();
      });
    }
    addMenuButton(tabContextMenu, 'Duplicate tab', () => {
      duplicateTab(tabId);
      hideTabContextMenu();
    });
    addMenuLabel(tabContextMenu, 'Tab color');
    for (const color of TAB_COLORS) {
      addColorMenuButton(tabContextMenu, color, (tab.tabColor || 'default') === color.id, () => {
        setTabColor(tabId, color.id);
        hideTabContextMenu();
      });
    }
    addMenuLabel(tabContextMenu, 'Move to group');
    for (const group of getTabGroups()) {
      addMenuButton(tabContextMenu, group.name || 'Untitled group', () => {
        moveTabToGroup(tabId, group.id);
        hideTabContextMenu();
      }, { checked: tab.groupId === group.id });
    }
    addMenuButton(tabContextMenu, 'New group…', () => {
      hideTabContextMenu();
      createGroup(tabId);
    });
    if (tab.groupId) {
      addMenuButton(tabContextMenu, 'No group', () => {
        moveTabToGroup(tabId, '');
        hideTabContextMenu();
      });
    }
    positionContextMenu(tabContextMenu, x, y);
  }

  async function closeGroup(groupId) {
    const members = [...state.tabs.values()].filter(tab => tab.groupId === groupId);
    const runs = members.filter(tab => tab.runId);
    if (runs.length && !state.runController) { showError(new Error('Enable Run Configurations to stop and close these runs.')); return; }
    if (runs.length && state.runController && !await state.runController.beforeClose(runs)) return;
    for (const tab of members) await closeTab(tab.id, { approved: true });
  }

  function showGroupContextMenu(x, y, groupId) {
    const group = getTabGroup(groupId);
    if (!group) return;
    tabContextMenu.innerHTML = '';
    addMenuLabel(tabContextMenu, 'Grid layout');
    for (const layout of GROUP_LAYOUTS) {
      addMenuButton(tabContextMenu, layout.label, () => {
        setGroupLayout(groupId, layout.id);
        hideTabContextMenu();
      }, { checked: (group.layout || '1x1') === layout.id });
    }
    addMenuLabel(tabContextMenu, 'Group');
    addMenuButton(tabContextMenu, 'Save group…', () => { hideTabContextMenu(); savedGroups.save(groupId); });
    if (group.savedGroupId) addMenuButton(tabContextMenu, 'Update saved group', () => { hideTabContextMenu(); savedGroups.save(groupId, true); });
    addMenuButton(tabContextMenu, 'Close group…', () => { hideTabContextMenu(); closeGroup(groupId).catch(showError); }, { danger: true });
    addMenuButton(tabContextMenu, 'Rename group…', () => {
      hideTabContextMenu();
      renameGroup(groupId);
    });
    addMenuButton(tabContextMenu, 'Ungroup tabs', () => {
      dissolveGroup(groupId);
      hideTabContextMenu();
    }, { danger: true });
    positionContextMenu(tabContextMenu, x, y);
  }

  function showTerminalContextMenu(x, y, tabId) {
    terminalContextMenu.innerHTML = '';
    const tab = state.tabs.get(tabId);
    if (!tab) return;

    const contextLink = tab.hoveredLink && tab.hoveredLink.uri ? { ...tab.hoveredLink } : null;
    if (contextLink) {
      addMenuLabel(terminalContextMenu, contextLink.type === 'email' ? 'Email' : 'Link');
      addMenuButton(terminalContextMenu, contextLink.type === 'email' ? 'Compose email' : 'Open link', () => {
        openExternalTarget(tab, contextLink.uri);
        hideTerminalContextMenu();
      });
      addMenuButton(terminalContextMenu, contextLink.type === 'email' ? 'Copy email address' : 'Copy link', () => {
        state.api.copyToClipboard(contextLink.text);
        hideTerminalContextMenu();
      });
    }

    addMenuLabel(terminalContextMenu, 'Terminal');
    const selectedText = tab.term.getSelection();
    const copyButton = addMenuButton(terminalContextMenu, 'Copy', () => {
      if (selectedText) state.api.copyToClipboard(selectedText);
      hideTerminalContextMenu();
    });
    copyButton.disabled = !selectedText;

    let clipboardText = '';
    const pasteButton = addMenuButton(terminalContextMenu, 'Paste', () => {
      if (clipboardText && tab.connected && !tab.readOnly) tab.term.paste(clipboardText);
      hideTerminalContextMenu();
    });
    pasteButton.disabled = true;
    pasteButton.title = tab.connected ? 'Reading clipboard…' : 'Connect this terminal to paste';
    if (tab.connected && !tab.readOnly) {
      state.api.readClipboard().then((text) => {
        clipboardText = String(text || '');
        if (!terminalContextMenu.classList.contains('open')) return;
        pasteButton.disabled = clipboardText.length === 0;
        pasteButton.title = clipboardText.length === 0 ? 'Clipboard is empty' : '';
      }).catch(() => {
        pasteButton.disabled = true;
        pasteButton.title = 'Clipboard unavailable';
      });
    }

    addMenuButton(terminalContextMenu, 'Select all', () => {
      tab.term.selectAll();
      hideTerminalContextMenu();
    });

    const killButton = addMenuButton(terminalContextMenu, 'Kill terminal', () => {
      if (state.api && typeof state.api.kill === 'function') {
        state.api.kill(tabId);
      }
      hideTerminalContextMenu();
    }, { danger: true });
    killButton.disabled = !tab.connected || tab.readOnly;
    positionContextMenu(terminalContextMenu, x, y);
  }

  function getWrappedTerminalText(term, bufferLineNumber) {
    const buffer = term && term.buffer ? term.buffer.active : null;
    if (!buffer) return null;
    let startLine = bufferLineNumber;
    let endLine = bufferLineNumber;
    while (startLine > 1) {
      const line = buffer.getLine(startLine - 1);
      if (!line || !line.isWrapped) break;
      startLine -= 1;
    }
    while (endLine < buffer.length) {
      const nextLine = buffer.getLine(endLine);
      if (!nextLine || !nextLine.isWrapped) break;
      endLine += 1;
    }
    let text = '';
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      const line = buffer.getLine(lineNumber - 1);
      if (!line) continue;
      text += line.translateToString(lineNumber === endLine);
    }
    return { text, startLine, endLine };
  }

  function registerSmartLinks(tab) {
    if (!tab || !tab.term || typeof tab.term.registerLinkProvider !== 'function') return;
    tab.linkProvider = tab.term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        try {
          const wrapped = getWrappedTerminalText(tab.term, bufferLineNumber);
          if (!wrapped) {
            callback(undefined);
            return;
          }
          const links = findTerminalLinks(wrapped.text).map((match) => {
            const startOffset = match.start;
            const endOffset = Math.max(match.start, match.end - 1);
            return {
              text: match.text,
              range: {
                start: {
                  x: (startOffset % tab.term.cols) + 1,
                  y: wrapped.startLine + Math.floor(startOffset / tab.term.cols)
                },
                end: {
                  x: (endOffset % tab.term.cols) + 1,
                  y: wrapped.startLine + Math.floor(endOffset / tab.term.cols)
                }
              },
              decorations: { pointerCursor: true, underline: true },
              activate: (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                openExternalTarget(tab, match.uri);
              },
              hover: () => {
                tab.hoveredLink = match;
              },
              leave: () => {
                if (tab.hoveredLink && tab.hoveredLink.uri === match.uri) tab.hoveredLink = null;
              }
            };
          });
          callback(links.length ? links : undefined);
        } catch (err) {
          callback(undefined);
        }
      }
    });
  }

  document.addEventListener('click', () => {
    hideTabContextMenu();
    hideTerminalContextMenu();
  });
  window.addEventListener('blur', () => {
    hideTabContextMenu();
    hideTerminalContextMenu();
  });

  function ensureHostOption(host) {
    if (!hostSelect || !host) return;
    const exists = Array.from(hostSelect.options).some((option) => option.value === host);
    if (!exists) {
      const option = document.createElement('option');
      option.value = host;
      option.textContent = host;
      hostSelect.appendChild(option);
    }
  }

  function setTabHost(tab, host) {
    if (!tab) return;
    tab.host = host || '';
    tab.sessionType = host === LOCAL_HOST_VALUE ? 'local' : 'ssh';
    tab.remotePathStyle = 'posix';
    if (state.appState && host) {
      state.appState = { ...state.appState, lastHost: host };
      state.api.updateState({ lastHost: host });
    }
    renderSessionTabs();
    updateTerminalGrid();
    if (tab.id === state.activeTabId) {
      ensureHostOption(tab.host);
      hostSelect.value = tab.host;
      if (filesPanel) {
        filesPanel.renderSavedLocations();
        filesPanel.renderRecentLocations();
      }
    }
    persistenceService.persistTabs();
  }

  function getTabTitleTemplate() {
    if (!settingsService || typeof settingsService.readSettingValue !== 'function') {
      return DEFAULT_TAB_TITLE_TEMPLATE;
    }
    return String(settingsService.readSettingValue('ui', 'session', 'tabTitleTemplate', DEFAULT_TAB_TITLE_TEMPLATE) || DEFAULT_TAB_TITLE_TEMPLATE);
  }

  function getDefaultTabColor() {
    if (!settingsService || typeof settingsService.readSettingValue !== 'function') {
      return 'default';
    }
    const value = String(settingsService.readSettingValue('ui', 'session', 'defaultTabColor', 'default') || 'default');
    return TAB_COLORS.some((color) => color.id === value) ? value : 'default';
  }

  function getConnectionLabel(tab) {
    if (!tab) return 'ssh:new';
    if (tab.sessionType === 'local') return 'local';
    return tab.host ? `ssh:${tab.host}` : 'ssh:new';
  }

  function getSessionTabLabel(tab) {
    if (!tab) return 'ssh:new';
    if (tab.manualTitle) return String(tab.manualTitle);
    const machine = tab.sessionType === 'local' ? 'local' : (tab.host || 'new');
    const title = interpolateTabTitle(getTabTitleTemplate(), {
      ssh_machine: machine,
      current_folder_name: getPathLabel(tab.currentPath || '/', tab.remotePathStyle),
      current_path: formatRemotePath(tab.currentPath || '/', tab.remotePathStyle),
      terminal_title: String(tab.terminalTitle || '').trim(),
      session_type: tab.sessionType || 'ssh'
    }).trim();
    return title || getConnectionLabel(tab);
  }

  function reorderTab(sourceId, targetId, placeAfter = false) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const source = state.tabs.get(sourceId);
    const target = state.tabs.get(targetId);
    if (!source || !target) return;
    const previousGroupId = source.groupId || '';
    source.groupId = target.groupId || '';
    const entries = Array.from(state.tabs.entries()).filter(([id]) => id !== sourceId);
    let targetIndex = entries.findIndex(([id]) => id === targetId);
    if (targetIndex < 0) return;
    if (placeAfter) targetIndex += 1;
    entries.splice(targetIndex, 0, [sourceId, source]);
    state.tabs = new Map(entries);
    if (previousGroupId && previousGroupId !== source.groupId && !Array.from(state.tabs.values()).some((tab) => tab.groupId === previousGroupId)) {
      state.appState.tabGroups = getTabGroups().filter((group) => group.id !== previousGroupId);
    }
    renderSessionTabs();
    updateTerminalGrid();
    persistenceService.persistTabs();
  }

  function buildTabButton(tab) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'session-tab';
      button.classList.add(`tab-color-${TAB_COLORS.some((color) => color.id === tab.tabColor) ? tab.tabColor : 'default'}`);
      button.dataset.tabId = tab.id;
      button.draggable = true;
      button.classList.toggle('active', tab.id === state.activeTabId);
      const label = getSessionTabLabel(tab);
      const labelEl = document.createElement('span');
      labelEl.className = 'session-tab-label';
      labelEl.textContent = label;
      button.appendChild(labelEl);
      const connectionLabel = getConnectionLabel(tab);
      button.title = tab.manualTitle ? `${label}\n${connectionLabel}` : label;

      const closeBtn = document.createElement('span');
      closeBtn.className = 'close-btn';
      closeBtn.innerHTML = '<i data-icon="x"></i>';
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      button.appendChild(closeBtn);

      button.addEventListener('click', () => {
        setActiveSessionTab(tab.id);
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showTabContextMenu(event.clientX, event.clientY, tab.id);
      });
      button.addEventListener('dragstart', (event) => {
        button.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/marinashell-tab', tab.id);
        event.dataTransfer.setData('text/plain', tab.id);
      });
      button.addEventListener('dragend', () => {
        button.classList.remove('dragging');
        sessionTabs.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
      button.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        button.classList.add('drag-over');
      });
      button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
      button.addEventListener('drop', (event) => {
        event.preventDefault();
        button.classList.remove('drag-over');
        const sourceId = event.dataTransfer.getData('text/marinashell-tab') || event.dataTransfer.getData('text/plain');
        const rect = button.getBoundingClientRect();
        reorderTab(sourceId, tab.id, event.clientX > rect.left + rect.width / 2);
      });
      return button;
  }

  function buildGroup(group, tabs) {
    const wrap = document.createElement('div');
    wrap.className = 'session-group';
    wrap.dataset.groupId = group.id;
    wrap.classList.toggle('active', tabs.some((tab) => tab.id === state.activeTabId));

    const header = document.createElement('div');
    header.className = 'session-group-header';
    header.title = 'Right-click for group options';
    const name = document.createElement('span');
    name.className = 'session-group-name';
    name.textContent = group.name || 'Untitled group';
    const layoutButton = document.createElement('button');
    layoutButton.type = 'button';
    layoutButton.className = 'session-group-layout';
    layoutButton.title = 'Choose grid layout';
    layoutButton.innerHTML = `<i data-icon="grid-2x2"></i><span>${(GROUP_LAYOUTS.find((item) => item.id === group.layout) || GROUP_LAYOUTS[0]).label}</span>`;
    layoutButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = layoutButton.getBoundingClientRect();
      showGroupContextMenu(rect.left, rect.bottom + 4, group.id);
    });
    header.appendChild(name);
    header.appendChild(layoutButton);
    header.addEventListener('click', () => {
      const target = tabs.find((tab) => tab.id === state.activeTabId) || tabs[0];
      if (target) setActiveSessionTab(target.id);
    });
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showGroupContextMenu(event.clientX, event.clientY, group.id);
    });
    header.addEventListener('dragover', (event) => {
      event.preventDefault();
      wrap.classList.add('drag-over');
    });
    header.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
    header.addEventListener('drop', (event) => {
      event.preventDefault();
      wrap.classList.remove('drag-over');
      const sourceId = event.dataTransfer.getData('text/marinashell-tab') || event.dataTransfer.getData('text/plain');
      moveTabToGroup(sourceId, group.id);
    });

    const tabList = document.createElement('div');
    tabList.className = 'session-group-tabs';
    tabs.forEach((tab) => tabList.appendChild(buildTabButton(tab)));
    wrap.appendChild(header);
    wrap.appendChild(tabList);
    return wrap;
  }

  function renderSessionTabs() {
    if (!sessionTabs) return;
    sessionTabs.innerHTML = '';
    const tabs = Array.from(state.tabs.values());
    const knownGroupIds = new Set(getTabGroups().map((group) => group.id));
    const ungrouped = tabs.filter((tab) => !tab.groupId || !knownGroupIds.has(tab.groupId));
    ungrouped.forEach((tab) => sessionTabs.appendChild(buildTabButton(tab)));
    for (const group of getTabGroups()) {
      const groupTabs = tabs.filter((tab) => tab.groupId === group.id);
      if (groupTabs.length) sessionTabs.appendChild(buildGroup(group, groupTabs));
    }
    renderLucide(sessionTabs);
  }

  function setActiveSessionTab(tabId, options = {}) {
    if (!state.tabs.has(tabId)) {
      return;
    }
    state.activeTabId = tabId;
    updateTerminalGrid();
    renderSessionTabs();
    syncUiToActiveTab();
    fitActiveTerminal();
    try {
      window.dispatchEvent(new CustomEvent('marinashell:active-tab-changed', { detail: { tabId } }));
    } catch (err) { }
    if (!options.skipPersist) {
      persistenceService.persistTabs();
    }
  }

  function fitActiveTerminal() {
    const visible = Array.from(state.tabs.values()).filter((tab) => tab.container.classList.contains('grid-visible') || tab.id === state.activeTabId);
    for (const tab of visible) {
      try {
        tab.fitAddon.fit();
        state.api.resize(tab.id, tab.term.cols, tab.term.rows);
      } catch (err) { }
    }
  }

  function updateTerminalGrid() {
    if (!terminalStack) return;
    const active = getActiveTab(state);
    let visible = active ? [active] : [];
    let layout = GROUP_LAYOUTS[0];
    const group = active && active.groupId ? getTabGroup(active.groupId) : null;
    if (group) {
      layout = GROUP_LAYOUTS.find((item) => item.id === group.layout) || GROUP_LAYOUTS[0];
      const groupTabs = Array.from(state.tabs.values()).filter((tab) => tab.groupId === group.id);
      const capacity = layout.columns * layout.rows;
      visible = groupTabs.slice(0, capacity);
      if (active && !visible.includes(active) && capacity > 0) {
        visible[capacity - 1] = active;
      }
    }
    const useGrid = visible.length > 1 || layout.id !== '1x1';
    terminalStack.classList.toggle('terminal-grid', useGrid);
    terminalStack.style.setProperty('--terminal-grid-columns', String(layout.columns));
    terminalStack.style.setProperty('--terminal-grid-rows', String(layout.rows));
    const visibleIds = new Set(visible.map((tab) => tab.id));
    state.tabs.forEach((tab) => {
      tab.container.classList.toggle('grid-visible', visibleIds.has(tab.id));
      tab.container.classList.toggle('active', tab.id === state.activeTabId);
      if (tab.gridLabel) tab.gridLabel.textContent = getSessionTabLabel(tab);
    });
    requestAnimationFrame(() => fitActiveTerminal());
  }

  function updateConnectUi(tab) {
    const connected = tab ? tab.connected : false;
    connectButton.textContent = connected ? 'Disconnect' : 'Connect';
    connectButton.disabled = Boolean(tab?.readOnly);
    hostSelect.disabled = connected || Boolean(tab?.readOnly);
    if (state.elements.pathInput) state.elements.pathInput.disabled = !connected;
    if (state.elements.pathGoButton) state.elements.pathGoButton.disabled = !connected;
    if (state.elements.pathSaveButton) state.elements.pathSaveButton.disabled = !connected;
    if (state.elements.backButton) state.elements.backButton.disabled = !connected;
    if (state.elements.forwardButton) state.elements.forwardButton.disabled = !connected;
  }

  function syncUiToActiveTab() {
    const tab = getActiveTab(state);
    if (!tab) {
      return;
    }
    ensureHostOption(tab.host);
    hostSelect.value = tab.host || hostSelect.value;
    if (!tab.host) {
      tab.host = hostSelect.value || '';
    }
    if (state.elements.pathInput) {
      state.elements.pathInput.value = formatRemotePath(tab.currentPath, tab.remotePathStyle);
    }
    updateConnectUi(tab);
    filesPanel.renderSavedLocations();
    filesPanel.renderRecentLocations();
    actionsPanel.renderTransfers();
    filesPanel.updateNavButtons();

    const defaultMessage = tab.connected
      ? (tab.sessionType === 'local' ? 'Connected to local shell' : `Connected to ${tab.host}`)
      : 'Disconnected';
    const message = tab.statusMessage || defaultMessage;
    if (statusLabel) {
      statusLabel.textContent = message;
      statusLabel.classList.toggle('error', Boolean(tab.statusIsError));
    }

    filesPanel.renderTree();
    filesPanel.ensureTreeLoaded(tab);
  }

  async function closeTab(tabId, options = {}) {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    if (tab.runId && !options.approved) {
      if (!state.runController || !await state.runController.beforeClose([tab])) return;
    }
    if (!tab.readOnly && tab.isBusy && !options.approved) {
      const proceed = window.confirm('A command is still running in this tab. Close anyway?');
      if (!proceed) {
        return;
      }
    }
    if (tab.connected) {
      state.api.disconnect(tabId);
    }
    if (tab.linkProvider && typeof tab.linkProvider.dispose === 'function') {
      try { tab.linkProvider.dispose(); } catch (err) { }
    }
    if (tab.runId && state.runController) await state.runController.closed(tab);
    tab.container.remove();
    // Let xterm finish its already queued viewport refresh before disposal.
    requestAnimationFrame(() => tab.term.dispose());
    state.tabs.delete(tabId);
    if (tab.groupId && !Array.from(state.tabs.values()).some((item) => item.groupId === tab.groupId)) {
      state.appState.tabGroups = getTabGroups().filter((group) => group.id !== tab.groupId);
    }
    if (state.activeTabId === tabId) {
      const nextInGroup = tab.groupId
        ? Array.from(state.tabs.values()).find((item) => item.groupId === tab.groupId)
        : null;
      const next = (nextInGroup && nextInGroup.id) || state.tabs.keys().next().value || null;
      if (next) {
        setActiveSessionTab(next);
      } else {
        const newTab = createTabState({ host: persistenceService.getDefaultHost(state.hostConfigs, hostSelect, state.appState.lastHost) });
        setActiveSessionTab(newTab.id);
      }
    } else {
      renderSessionTabs();
    }
    persistenceService.persistTabs();
  }

  function closeActiveTab() {
    const tab = getActiveTab(state);
    if (!tab) return;
    closeTab(tab.id);
  }

  function createTabState(initial = {}) {
    const id = initial.id || `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const container = document.createElement('div');
    container.className = 'terminal-pane';
    container.dataset.tabId = id;
    terminalStack.appendChild(container);

    const term = new TerminalCtor({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: !initial.readOnly,
      disableStdin: Boolean(initial.readOnly),
      convertEol: Boolean(initial.readOnly),
      theme: {
        background: '#191a1c',
        foreground: '#bcbec4'
      }
    });
    const fitAddon = new FitAddonCtor();
    term.loadAddon(fitAddon);
    term.open(container);

    const gridLabel = document.createElement('div');
    gridLabel.className = 'terminal-grid-label';
    container.appendChild(gridLabel);

    container.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideTabContextMenu();
      showTerminalContextMenu(event.clientX, event.clientY, id);
    });

    const initialPath = initial.currentPath || '/';
    const inferredStyle = /^\/[A-Za-z]:/.test(initialPath) ? 'windows' : 'posix';
    const tabState = {
      id,
      host: initial.host || '',
      sessionType: initial.sessionType || (initial.host === LOCAL_HOST_VALUE ? 'local' : 'ssh'),
      connected: false,
      readOnly: Boolean(initial.readOnly),
      runId: initial.runId || '',
      configurationId: initial.configurationId || '',
      terminalTitle: '',
      manualTitle: initial.manualTitle || '',
      tabColor: TAB_COLORS.some((color) => color.id === initial.tabColor) ? initial.tabColor : getDefaultTabColor(),
      groupId: initial.groupId || '',
      term,
      fitAddon,
      container,
      gridLabel,
      hoveredLink: null,
      linkProvider: null,
      treeCache: new Map(),
      expandedDirs: new Set([initial.treeRootPath || initial.currentPath || '/']),
      treePages: new Map(),
      transferRows: new Map(),
      currentPath: initialPath,
      treeRootPath: initial.treeRootPath || initialPath || '/',
      navHistory: [],
      navIndex: -1,
      statusMessage: 'Disconnected',
      statusIsError: false,
      restoreConnected: Boolean(initial.connected),
      isBusy: false,
      treeRefreshTimer: null,
      remotePathStyle: inferredStyle,
      activeTunnels: new Map() // ID -> { type, config, status, error }
    };

    registerSmartLinks(tabState);

    let titleRenderTimer = null;
    term.onTitleChange((title) => {
      tabState.terminalTitle = title || '';
      if (titleRenderTimer) return;
      titleRenderTimer = setTimeout(() => {
        titleRenderTimer = null;
        renderSessionTabs();
        updateTerminalGrid();
      }, 80);
    });

    container.addEventListener('pointerdown', () => {
      if (state.activeTabId !== id) setActiveSessionTab(id);
    });

    term.onData((data) => {
      if (tabState.connected && !tabState.readOnly) {
        if (data.includes('\r') || data.includes('\n')) {
          tabState.isBusy = true;
        }
        state.api.write(tabState.id, data);
      }
    });

    const isMac = navigator.platform && navigator.platform.toLowerCase().includes('mac');
    term.attachCustomKeyEventHandler((event) => {
      const key = event.key ? event.key.toLowerCase() : '';
      const hasModifier = isMac ? event.metaKey : event.ctrlKey;
      if (hasModifier && key === 'c') {
        const selection = term.getSelection();
        if (selection) {
          state.api.copyToClipboard(selection);
          return false;
        }
        return true;
      }
      if (hasModifier && key === 'v') {
        // xterm calls this handler for both keydown and keyup. Returning false
        // only stops xterm; cancel the browser's native paste as well.
        event.preventDefault();
        if (event.type !== 'keydown') return false;
        if (tabState.connected && !tabState.readOnly) {
          state.api.readClipboard().then((text) => {
            if (text) {
              term.paste(text);
            }
          });
        }
        return false;
      }
      return true;
    });

    state.tabs.set(id, tabState);
    return tabState;
  }

  function createNewTab(options = {}) {
    const lastHost = state.appState ? state.appState.lastHost : '';
    const host = options.host || persistenceService.getDefaultHost(state.hostConfigs, hostSelect, lastHost);
    const active = getActiveTab(state);
    const tab = createTabState({
      host,
      currentPath: options.path || '/',
      treeRootPath: options.path || '/',
      tabColor: options.tabColor,
      groupId: Object.prototype.hasOwnProperty.call(options, 'groupId')
        ? options.groupId
        : (active && active.groupId ? active.groupId : '')
    });
    setActiveSessionTab(tab.id);
    if (options.connect && host) {
      connectTab(tab, host, { restorePath: options.path || tab.currentPath || '/' });
    }
    persistenceService.persistTabs();
    return tab;
  }

  function duplicateTab(tabId) {
    const source = state.tabs.get(tabId);
    if (!source || source.readOnly) return;
    const host = source.host || persistenceService.getDefaultHost(state.hostConfigs, hostSelect, state.appState.lastHost);
    const path = source.currentPath || '/';
    createNewTab({ host, path, connect: source.connected, groupId: source.groupId || '', tabColor: source.tabColor || 'default' });
  }

  function setSidebarTab(name) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === name;
      button.classList.toggle('active', isActive);
    });
    tabPanels.forEach((panel) => {
      const isActive = panel.id === `tab-${name}`;
      panel.classList.toggle('active', isActive);
    });
  }

  async function refreshHosts() {
    try {
      const hosts = await state.api.getHosts();
      hostSelect.innerHTML = '';
      state.hostConfigs.clear();
      const localOption = document.createElement('option');
      localOption.value = LOCAL_HOST_VALUE;
      localOption.textContent = LOCAL_HOST_LABEL;
      hostSelect.appendChild(localOption);
      state.hostConfigs.set(LOCAL_HOST_VALUE, { alias: LOCAL_HOST_LABEL, type: 'local' });
      if (hosts && hosts.length) {
        for (const host of hosts) {
          const option = document.createElement('option');
          option.value = host.alias;
          option.textContent = host.alias;
          hostSelect.appendChild(option);
          state.hostConfigs.set(host.alias, host);
        }
      }
      const tab = getActiveTab(state);
      if (tab && tab.host) {
        ensureHostOption(tab.host);
        hostSelect.value = tab.host;
      } else if (hostSelect.options.length) {
        hostSelect.value = persistenceService.getDefaultHost(state.hostConfigs, hostSelect, state.appState.lastHost);
      }
      const statusTab = getActiveTab(state);
      if (statusTab && statusTab.statusMessage === 'Disconnected') {
        const count = hosts ? hosts.length : 0;
        persistenceService.setStatus(`Loaded ${count} SSH hosts`, false, statusTab);
      }
    } catch (err) {
      hostSelect.innerHTML = '';
      const localOption = document.createElement('option');
      localOption.value = LOCAL_HOST_VALUE;
      localOption.textContent = LOCAL_HOST_LABEL;
      hostSelect.appendChild(localOption);
      state.hostConfigs.clear();
      state.hostConfigs.set(LOCAL_HOST_VALUE, { alias: LOCAL_HOST_LABEL, type: 'local' });
      const tab = getActiveTab(state);
      persistenceService.setStatus('Failed to read ~/.ssh/config', true, tab);
    }
  }

  function formatBytes(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    const digits = i === 0 ? 0 : (i === 1 ? 1 : 2);
    return `${v.toFixed(digits)} ${units[i]}`;
  }

  function updateSidebarTransfer(tab, payload) {
    const wrap = state.elements.statusTransfer;
    const labelEl = state.elements.statusTransferLabel;
    const metaEl = state.elements.statusTransferMeta;
    const fillEl = state.elements.statusTransferFill;
    if (!wrap || !labelEl || !metaEl || !fillEl) return;
    if (!tab || tab.id !== state.activeTabId) return;
    if (!payload || !payload.id) return;

    // Track which transfer should be shown in the sidebar.
    if (!tab.latestTransferId) {
      tab.latestTransferId = payload.id;
    }
    if (tab.latestTransferId !== payload.id) {
      // Only show the most recent transfer for this tab.
      return;
    }

    wrap.classList.add('visible');
    if (payload.text) {
      wrap.classList.add('indeterminate');
      labelEl.textContent = tab.latestTransferLabel || 'Transfer';
      metaEl.textContent = String(payload.text);
      fillEl.style.width = '40%';
      return;
    }
    wrap.classList.remove('indeterminate');
    const transferred = Number(payload.transferred || 0);
    const total = Number(payload.total || 0);
    labelEl.textContent = tab.latestTransferLabel || 'Transfer';
    if (!total) {
      metaEl.textContent = `${formatBytes(transferred)} / ?`;
      fillEl.style.width = '0%';
      return;
    }
    const pct = Math.min(100, Math.round((transferred / total) * 100));
    metaEl.textContent = `${pct}% · ${formatBytes(transferred)} / ${formatBytes(total)}`;
    fillEl.style.width = `${pct}%`;
    if (pct >= 100) {
      setTimeout(() => {
        // Hide once complete, but only if we're still showing the same transfer.
        if (!wrap.classList.contains('visible')) return;
        const active = getTab(state, tab.id);
        if (!active || active.latestTransferId !== payload.id) return;
        wrap.classList.remove('visible');
        wrap.classList.remove('indeterminate');
        fillEl.style.width = '0%';
        labelEl.textContent = '';
        metaEl.textContent = '';
      }, 1200);
    }
  }

  function setupTerminalHandlers() {
    if (!state.api) {
      return;
    }

    state.api.onSshData((payload) => {
      const tab = getTab(state, payload.tabId);
      if (!tab) return;
      tab.term.write(payload.data);
    });

    state.api.onSshCwd((payload) => {
      const tab = getTab(state, payload.tabId);
      if (!tab || !payload.cwd) return;
      const cwdValue = String(payload.cwd);
      const looksWindows = /^[A-Za-z]:[\\/]/.test(cwdValue) || /^\/[A-Za-z]:/.test(cwdValue);
      if (looksWindows && tab.remotePathStyle !== 'windows') {
        tab.remotePathStyle = 'windows';
      }
      filesPanel.updateTabPath(tab, payload.cwd, {
        pushNav: true,
        recordRecent: true,
        clearCache: true,
        force: true
      });
    });

    state.api.onSshExit((payload) => {
      const tab = getTab(state, payload.tabId);
      if (!tab) return;
      if (tab.activeTunnels && typeof tab.activeTunnels.clear === 'function') {
        tab.activeTunnels.clear();
      }
      setConnectedForTab(tab, false);
      tab.isBusy = false;
      persistenceService.setStatus('Disconnected', true, tab);
      filesPanel.resetTreeForTab(tab, true);
      if (tab.id === state.activeTabId) {
        filesPanel.renderTree();
        actionsPanel.renderTunnels();
      }
      try {
        window.dispatchEvent(new CustomEvent('marinashell:ssh-exit', { detail: payload }));
      } catch (err) { }
    });

    state.api.onSshPrompt((payload) => {
      const tab = getTab(state, payload.tabId);
      if (!tab) return;
      tab.isBusy = false;
      try {
        window.dispatchEvent(new CustomEvent('marinashell:ssh-prompt', { detail: payload }));
      } catch (err) { }
    });

    state.api.onSftpProgress((payload) => {
      if (!payload) return;
      const tab = getTab(state, payload.tabId);
      if (tab) {
        if (!tab.latestTransferId) tab.latestTransferId = payload.id;
        updateSidebarTransfer(tab, payload);
      }
      if (payload.text && typeof actionsPanel.updateTransferRowTextForTab === 'function') {
        actionsPanel.updateTransferRowTextForTab(payload.tabId, payload.id, payload.text);
        return;
      }
      actionsPanel.updateTransferRowForTab(payload.tabId, payload.transferred, payload.total, payload.id);
    });

    if (state.api.onTunnelStatus) { // check if exposed
      state.api.onTunnelStatus((payload) => {
        const tab = getTab(state, payload.tabId);
        if (!tab) return;

        const tunnelId = payload && (payload.tunnelId || payload.id) ? (payload.tunnelId || payload.id) : null;
        if (!tunnelId) return;

        const tunnel = tab.activeTunnels.get(tunnelId);
        if (tunnel) {
          if (payload.status === 'closed') {
            tab.activeTunnels.delete(tunnelId);
          } else {
            tunnel.status = payload.status;
            tunnel.error = payload.error;
          }
        }

        if (tab.id === state.activeTabId) {
          actionsPanel.renderTunnels();
        }
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      fitActiveTerminal();
    });
    resizeObserver.observe(terminalStack);
  }

  async function connectTab(tab, host, options = {}) {
    if (tab.readOnly) return false;
    if (!state.api) {
      persistenceService.setStatus('IPC unavailable', true, tab);
      return false;
    }
    if (!host) {
      persistenceService.setStatus('No host selected', true, tab);
      return false;
    }

    tab.sessionType = host === LOCAL_HOST_VALUE ? 'local' : 'ssh';
    const label = tab.sessionType === 'local' ? 'local shell' : host;
    persistenceService.setStatus(`Connecting to ${label}...`, false, tab);
    const result = await state.api.connect(tab.id, host);
    if (!result || !result.ok) {
      persistenceService.setStatus(result && result.error ? result.error : 'Connection failed', true, tab);
      setConnectedForTab(tab, false);
      return false;
    }

    setConnectedForTab(tab, true);
    setTabHost(tab, host);
    persistenceService.setStatus(`Connected to ${label}`, false, tab);

    // Start saved tunnels (optional)
    const shouldAutoStart = settingsService && typeof settingsService.shouldAutoStartTunnels === 'function'
      ? settingsService.shouldAutoStartTunnels()
      : true;
    const tunnelProfiles = shouldAutoStart ? persistenceService.getTunnelProfiles(host) : [];
    if (tunnelProfiles && tunnelProfiles.length > 0) {
      persistenceService.setStatus(`Starting ${tunnelProfiles.length} tunnels...`, false, tab);
      for (const profile of tunnelProfiles) {
        try {
          const result = await state.api.createTunnel({
            tabId: tab.id,
            type: profile.type,
            config: {
              srcPort: profile.srcPort,
              dstHost: profile.dstHost,
              dstPort: profile.dstPort
            }
          });
          if (result && result.ok) {
            tab.activeTunnels.set(result.id, {
              type: profile.type,
              config: {
                srcPort: profile.srcPort,
                dstHost: profile.dstHost,
                dstPort: profile.dstPort
              },
              status: 'ready'
            });
          }
        } catch (err) {
          console.error('Failed to start tunnel', err);
        }
      }
      if (tab.id === state.activeTabId) {
        actionsPanel.renderTunnels();
      }
      // Don’t leave the UI stuck on "Starting ... tunnels..."
      persistenceService.setStatus(`Connected to ${label}`, false, tab);
    }

    tab.navHistory = [];
    tab.navIndex = -1;
    tab.isBusy = false;

    const targetPath = options.path || tab.currentPath || '/';
    if (options.restorePath) {
      filesPanel.updateTabPath(tab, options.restorePath, { pushNav: true, recordRecent: false, clearCache: true, force: true });
      const cdCommand = buildRemoteCdCommand(options.restorePath, { pathStyle: tab.remotePathStyle });
      state.api.write(tab.id, `${cdCommand}\n`);
    } else {
      filesPanel.updateTabPath(tab, targetPath, { pushNav: true, recordRecent: false, clearCache: true, force: true });
    }

    if (tab.id === state.activeTabId) {
      fitActiveTerminal();
    }

    return true;
  }

  async function disconnectTab(tab) {
    if (!state.api) {
      persistenceService.setStatus('IPC unavailable', true, tab);
      return;
    }
    await state.api.disconnect(tab.id);
    if (tab.activeTunnels && typeof tab.activeTunnels.clear === 'function') {
      tab.activeTunnels.clear();
    }
    setConnectedForTab(tab, false);
    persistenceService.setStatus('Disconnected', false, tab);
    filesPanel.resetTreeForTab(tab, true);
    if (tab.id === state.activeTabId) {
      filesPanel.renderTree();
      actionsPanel.renderTunnels();
    }
  }

  function setConnectedForTab(tab, next) {
    if (!tab) return;
    tab.connected = next;
    if (tab.id === state.activeTabId) {
      updateConnectUi(tab);
    }
    try {
      window.dispatchEvent(new CustomEvent('marinashell:session-state-changed', { detail: { tabId: tab.id, connected: next } }));
    } catch (err) { }
    persistenceService.persistTabs();
  }

  function bindEvents() {
    connectButton.addEventListener('click', async () => {
      const tab = getActiveTab(state);
      if (!tab) return;
      if (tab.connected) {
        await disconnectTab(tab);
      } else {
        await connectTab(tab, hostSelect.value || tab.host || persistenceService.getDefaultHost(state.hostConfigs, hostSelect, state.appState.lastHost));
      }
    });

    if (newTabButton) {
      newTabButton.addEventListener('click', () => {
        createNewTab();
      });
    }

    if (newGroupButton) {
      newGroupButton.addEventListener('click', () => {
        const active = getActiveTab(state);
        if (active) createGroup(active.id);
      });
    }

    hostSelect.addEventListener('change', () => {
      const tab = getActiveTab(state);
      if (!tab || tab.connected) {
        return;
      }
      const nextHost = hostSelect.value;
      setTabHost(tab, nextHost);
      if (settingsService && settingsService.shouldAutoConnectOnSelect()) {
        connectTab(tab, nextHost);
      }
    });

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setSidebarTab(button.dataset.tab);
      });
    });
  }

  const savedGroups = createSavedGroups(state, { createTabState, connectTab, setActiveSessionTab, renderSessionTabs, updateTerminalGrid }, askForText, getSessionTabLabel);
  bindEvents();

  window.addEventListener('marinashell:tab-path-changed', () => {
    renderSessionTabs();
    updateTerminalGrid();
  });

  return {
    refreshHosts,
    setupTerminalHandlers,
    createTabState,
    setActiveSessionTab,
    fitActiveTerminal,
    connectTab,
    disconnectTab,
    renderSessionTabs,
    syncUiToActiveTab,
    createNewTab,
    closeActiveTab,
    closeTab,
    savedGroups,
    duplicateTab,
    updateTerminalGrid,
    createGroup,
    setSidebarTab
  };
}
