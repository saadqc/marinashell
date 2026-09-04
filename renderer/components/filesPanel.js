import { getActiveTab } from '../state.js';
import {
  getPathLabel,
  normalizeRemotePath,
  formatRemotePath,
  buildRemoteCdCommand
} from '../utils.js';
import { getIconClassForItem } from '../services/iconService.js';
import { MAX_RECENT } from '../constants.js';

export function createFilesPanel(state, persistenceService, editorService, actionsBridge) {
  const {
    fileTree,
    backButton,
    forwardButton,
    pathInput,
    pathGoButton,
    pathSaveButton,
    savedPaths,
    recentPaths,
    sectionHeaders
  } = state.elements;

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  document.body.appendChild(contextMenu);

  function hideContextMenu() {
    contextMenu.classList.remove('open');
    contextMenu.innerHTML = '';
  }

  let renameCleanup = null;

  function beginInlineRename(tab, item, row, labelEl) {
    if (!tab || !item || !row || !labelEl) return;
    if (!state.api || typeof state.api.renamePath !== 'function') {
      persistenceService.setStatus('Rename unavailable', true, tab);
      return;
    }
    if (renameCleanup) {
      try { renameCleanup(); } catch (err) { }
      renameCleanup = null;
    }

    const originalName = String(item.name || '');
    const originalPath = String(item.path || '');
    if (!originalName || !originalPath) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalName;
    input.className = 'tree-rename-input';
    input.style.width = '100%';
    input.style.maxWidth = '220px';
    input.style.background = 'rgba(15, 19, 32, 0.65)';
    input.style.border = '1px solid rgba(255,255,255,0.12)';
    input.style.borderRadius = '8px';
    input.style.color = 'rgba(255,255,255,0.92)';
    input.style.padding = '4px 6px';
    input.style.fontSize = '12px';
    input.style.outline = 'none';

    const parentPath = tab.sessionType === 'local'
      ? (originalPath.includes('\\') ? originalPath.replace(/\\[^\\]+$/, '') : originalPath.replace(/\/[^/]+$/, ''))
      : (originalPath.replace(/\/[^/]+$/, '') || '/');

    const commit = async (mode) => {
      const nextName = String(input.value || '').trim();
      cleanup();
      if (mode !== 'save') return;
      if (!nextName || nextName === originalName) return;
      if (/[\/\\]/.test(nextName)) {
        persistenceService.setStatus('Invalid name', true, tab);
        return;
      }

      persistenceService.setStatus('Renaming...', false, tab);
      const newPath = tab.sessionType === 'local'
        ? (parentPath ? `${parentPath}${parentPath.endsWith('\\') || parentPath.endsWith('/') ? '' : (originalPath.includes('\\') ? '\\' : '/')}${nextName}` : nextName)
        : `${(parentPath === '/' ? '' : parentPath)}/${nextName}`;

      const res = await state.api.renamePath(tab.id, { oldPath: originalPath, newPath });
      if (!res || !res.ok) {
        persistenceService.setStatus(res && res.error ? res.error : 'Rename failed', true, tab);
        return;
      }

      // Update local tree caches
      try {
        // clear parent listing cache
        tab.treeCache.delete(parentPath || '/');
        // clear renamed subtree caches (best-effort)
        const sep = tab.sessionType === 'local'
          ? (originalPath.includes('\\') ? '\\' : '/')
          : '/';
        for (const key of Array.from(tab.treeCache.keys())) {
          if (key === originalPath || key.startsWith(`${originalPath}${sep}`)) {
            tab.treeCache.delete(key);
          }
        }
        // remap expanded dirs
        if (item.type === 'd') {
          const nextExpanded = new Set();
          for (const p of tab.expandedDirs) {
            const sp = String(p || '');
            if (sp === originalPath || sp.startsWith(`${originalPath}${sep}`)) {
              nextExpanded.add(newPath + sp.slice(originalPath.length));
            } else {
              nextExpanded.add(sp);
            }
          }
          tab.expandedDirs.clear();
          for (const p of nextExpanded) tab.expandedDirs.add(p);
        }
      } catch (err) { }

      setSelectedPath(tab, newPath);
      await loadDirectoryForTab(tab, parentPath || '/');
      if (tab.id === state.activeTabId) {
        renderTree();
      }
      persistenceService.setStatus('Renamed', false, tab);
    };

    const cleanup = () => {
      if (renameCleanup) {
        try { renameCleanup(); } catch (err) { }
      }
      renameCleanup = null;
    };

    const restore = () => {
      if (!row.isConnected) return;
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = originalName;
      try {
        input.replaceWith(label);
      } catch (err) {
        // fallback
        labelEl.textContent = originalName;
        if (labelEl.parentElement) {
          labelEl.parentElement.replaceChild(label, labelEl);
        }
      }
    };

    renameCleanup = () => {
      try { restore(); } catch (err) { }
    };

    labelEl.replaceWith(input);
    setTimeout(() => {
      try { input.focus(); input.select(); } catch (err) { }
    }, 0);

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        restore();
        cleanup();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit('save').catch(() => { });
      }
    });
    input.addEventListener('blur', () => {
      commit('save').catch(() => { });
    });
  }

  function showContextMenu(x, y, tab, item, row, labelEl) {
    contextMenu.innerHTML = '';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy path';
    copyButton.addEventListener('click', async () => {
      await state.api.copyToClipboard(item.path);
      hideContextMenu();
      persistenceService.setStatus('Path copied', false, tab);
    });
    contextMenu.appendChild(copyButton);

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = item.type === 'd' ? 'Download folder…' : 'Download…';
    downloadButton.addEventListener('click', async () => {
      hideContextMenu();
      if (!tab || !tab.connected) {
        persistenceService.setStatus('Not connected', true, tab);
        return;
      }
      if (tab.sessionType === 'local') {
        persistenceService.setStatus('Download from local tree not implemented yet', true, tab);
        return;
      }
      const id = `download-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      actionsBridge && actionsBridge.createTransferRow && actionsBridge.createTransferRow(
        id,
        item.type === 'd' ? `Download ${item.name}.tar.gz` : `Download ${item.name}`
      );
      persistenceService.setStatus('Downloading...', false, tab);
      const result = item.type === 'd'
        ? await state.api.downloadFolder(tab.id, { remotePath: item.path, id })
        : await state.api.download(tab.id, { remotePath: item.path, id });
      if (result && result.ok) {
        actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'downloaded');
        persistenceService.setStatus('Downloaded', false, tab);
      } else {
        actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'error');
        persistenceService.setStatus(result && result.error ? result.error : 'Download failed', true, tab);
      }
    });
    contextMenu.appendChild(downloadButton);

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.textContent = 'Rename…';
    renameButton.addEventListener('click', () => {
      hideContextMenu();
      beginInlineRename(tab, item, row, labelEl);
    });
    contextMenu.appendChild(renameButton);

    if (item.type === 'd') {
      const bookmarkButton = document.createElement('button');
      bookmarkButton.type = 'button';
      bookmarkButton.textContent = 'Bookmark folder';
      bookmarkButton.addEventListener('click', () => {
        if (!tab || !tab.host) {
          persistenceService.setStatus('No host selected', true, tab);
          hideContextMenu();
          return;
        }
        const saved = persistenceService.getHostState(state.appState.savedLocations, tab.host);
        if (!saved.includes(item.path)) {
          const next = [item.path, ...saved];
          persistenceService.updateHostState('savedLocations', tab.host, next);
          if (tab.id === state.activeTabId) {
            renderSavedLocations();
          }
        }
        hideContextMenu();
      });
      contextMenu.appendChild(bookmarkButton);
    }

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('open');
  }

  document.addEventListener('click', () => hideContextMenu());
  window.addEventListener('blur', () => hideContextMenu());

  function updateNavButtons() {
    const tab = getActiveTab(state);
    if (!tab || !tab.connected) {
      backButton.disabled = true;
      forwardButton.disabled = true;
      return;
    }
    // Back button now behaves as "Up"
    const isRoot = tab.currentPath === '/' || /^[A-Za-z]:\\?$/.test(tab.currentPath);
    backButton.disabled = isRoot;
    backButton.title = 'Go up';
    if (forwardButton) forwardButton.style.display = 'none';
  }

  function setPathInputValue(tab, value) {
    if (pathInput) {
      pathInput.value = formatRemotePath(value, tab ? tab.remotePathStyle : 'posix');
    }
  }

  function normalizeForTab(tab, value) {
    return normalizeRemotePath(value, tab ? tab.currentPath : '/', {
      pathStyle: tab ? tab.remotePathStyle : 'posix'
    });
  }

  function updateSectionUI(name) {
    const body = document.getElementById(`${name}-section`);
    const chevron = document.getElementById(`${name}-chevron`);
    const expanded = Boolean(state.sectionState[name]);
    if (body) {
      body.classList.toggle('collapsed', !expanded);
    }
    if (chevron) {
      chevron.textContent = expanded ? '▾' : '▸';
    }
  }

  function toggleSection(name) {
    state.sectionState[name] = !state.sectionState[name];
    updateSectionUI(name);
  }

  function updateTabPath(tab, nextPath, options = {}) {
    if (!tab) {
      return;
    }
    const normalized = normalizeForTab(tab, nextPath);
    if (normalized === tab.currentPath && !options.force) {
      return;
    }
    tab.currentPath = normalized;
    tab.treeRootPath = normalized;
    if (tab.id === state.activeTabId) {
      setPathInputValue(tab, normalized);
    }
    if (options.pushNav) {
      const currentEntry = tab.navHistory[tab.navIndex];
      if (currentEntry !== normalized) {
        tab.navHistory = tab.navHistory.slice(0, tab.navIndex + 1);
        tab.navHistory.push(normalized);
        tab.navIndex = tab.navHistory.length - 1;
      }
    }
    if (options.recordRecent && tab.host) {
      const recent = persistenceService.getHostState(state.appState.recentLocations, tab.host);
      const filtered = recent.filter((entry) => entry !== normalized);
      filtered.unshift(normalized);
      persistenceService.updateHostState('recentLocations', tab.host, filtered.slice(0, MAX_RECENT));
      if (tab.id === state.activeTabId) {
        renderRecentLocations();
      }
    }
    if (tab.id === state.activeTabId) {
      updateNavButtons();
    }
    scheduleTreeRefresh(tab, Boolean(options.clearCache));
    persistenceService.persistTabs();
    try {
      window.dispatchEvent(new CustomEvent('marinashell:tab-path-changed', {
        detail: { tabId: tab.id, path: normalized }
      }));
    } catch (err) { }
  }

  function setSelectedPath(tab, path) {
    if (!tab) return;
    tab.selectedPath = path;
    if (tab.id === state.activeTabId) {
      renderTree();
    }
  }

  function scheduleTreeRefresh(tab, clearCache) {
    if (!tab) return;
    if (tab.treeRefreshTimer) {
      clearTimeout(tab.treeRefreshTimer);
    }
    tab.treeRefreshTimer = setTimeout(async () => {
      resetTreeForTab(tab, clearCache);
      await loadDirectoryForTab(tab, tab.treeRootPath);
      if (tab.id === state.activeTabId) {
        renderTree();
      }
    }, 120);
  }

  function navigateToPathForTab(tab, nextPath, options = {}) {
    if (!tab || !tab.connected || !state.api) {
      persistenceService.setStatus('Not connected', true, tab);
      return;
    }
    const rawInput = nextPath ? String(nextPath).trim() : '';
    if (!rawInput) {
      persistenceService.setStatus('Enter a path', true, tab);
      return;
    }
    const normalized = normalizeForTab(tab, rawInput);
    if (!normalized) {
      return;
    }
    if (options.sendCommand !== false) {
      if (tab.remotePathStyle === 'windows' && normalized === '/') {
        updateTabPath(tab, normalized, {
          pushNav: options.pushNav,
          recordRecent: options.recordRecent,
          clearCache: options.clearCache
        });
        return;
      }
      tab.isBusy = true;
      const cdCommand = buildRemoteCdCommand(normalized, { pathStyle: tab.remotePathStyle });
      state.api.write(tab.id, `${cdCommand}\n`);
    }
    updateTabPath(tab, normalized, {
      pushNav: options.pushNav,
      recordRecent: options.recordRecent,
      clearCache: options.clearCache
    });
  }

  function resetTreeForTab(tab, clearCache = false) {
    if (!tab) {
      fileTree.textContent = 'Not connected';
      return;
    }
    if (clearCache) {
      tab.treeCache.clear();
    }
    tab.expandedDirs.clear();
    tab.expandedDirs.add(tab.treeRootPath);
    tab.treePages.clear();
    if (tab.id === state.activeTabId) {
      fileTree.textContent = tab.connected ? 'Loading...' : 'Not connected';
    }
  }

  async function loadDirectoryForTab(tab, remotePath) {
    if (!tab || !tab.connected || tab.treeCache.has(remotePath)) {
      return;
    }
    try {
      const list = tab.sessionType === 'local'
        ? await state.api.listLocal(tab.id, remotePath)
        : await state.api.list(tab.id, remotePath);
      tab.treeCache.set(remotePath, list || []);
      if (tab.sessionType !== 'local' && remotePath === '/' && Array.isArray(list)) {
        const hasDriveRoot = list.some((entry) => entry && /^[A-Za-z]:$/.test(entry.name || ''));
        if (hasDriveRoot && tab.remotePathStyle !== 'windows') {
          tab.remotePathStyle = 'windows';
          if (tab.id === state.activeTabId) {
            setPathInputValue(tab, tab.currentPath || '/');
          }
        }
      }
    } catch (err) {
      persistenceService.setStatus('Failed to list path', true, tab);
    }
  }

  function ensureTreeLoaded(tab) {
    if (!tab || !tab.connected) {
      return;
    }
    if (!tab.treeCache.has(tab.treeRootPath)) {
      loadDirectoryForTab(tab, tab.treeRootPath).then(() => {
        if (tab.id === state.activeTabId) {
          renderTree();
        }
      });
    }
  }

  function renderTree() {
    fileTree.innerHTML = '';
    const tab = getActiveTab(state);
    if (!tab || !tab.connected) {
      fileTree.textContent = 'Not connected';
      return;
    }
    if (!tab.treeCache.has(tab.treeRootPath)) {
      fileTree.textContent = 'Loading...';
      return;
    }
    const container = document.createElement('div');
    container.className = 'tree-root';
    renderDirectory(tab, tab.treeRootPath, 0, container);
    fileTree.appendChild(container);
  }

  function renderDirectory(tab, remotePath, depth, container) {
    const items = tab.treeCache.get(remotePath) || [];
    const sorted = items.slice().sort((a, b) => {
      if (a.type === 'd' && b.type !== 'd') return -1;
      if (a.type !== 'd' && b.type === 'd') return 1;
      return a.name.localeCompare(b.name);
    });
    const page = tab.treePages.get(remotePath) || 0;
    const start = page * state.treePageSize;
    const end = Math.min(sorted.length, start + state.treePageSize);
    const visible = sorted.slice(start, end);

    for (const item of visible) {
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.dataset.path = item.path;
      if (tab.selectedPath === item.path) {
        row.classList.add('selected');
      }
      row.style.paddingLeft = `${depth * 14}px`;

      const indicator = document.createElement('span');
      indicator.className = 'tree-indicator';

      if (item.type === 'd') {
        indicator.textContent = tab.expandedDirs.has(item.path) ? 'v' : '>';
      } else {
        indicator.textContent = '-';
      }

      const icon = document.createElement('span');
      icon.className = `tree-icon ${getIconClassForItem(item, tab.expandedDirs.has(item.path))}`;

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = item.name;

      row.appendChild(indicator);
      row.appendChild(icon);
      row.appendChild(label);
      container.appendChild(row);

      if (item.type === 'd') {
        row.addEventListener('click', async (event) => {
          event.stopPropagation();
          setSelectedPath(tab, item.path);
          if (!tab.isBusy) {
            navigateToPathForTab(tab, item.path, { pushNav: true, recordRecent: true, clearCache: true });
          } else {
            persistenceService.setStatus('Command running, navigation paused', true, tab);
          }
          if (tab.expandedDirs.has(item.path)) {
            tab.expandedDirs.delete(item.path);
            tab.treePages.set(item.path, 0);
            renderTree();
            return;
          }
          tab.expandedDirs.add(item.path);
          await loadDirectoryForTab(tab, item.path);
          renderTree();
        });

        if (tab.expandedDirs.has(item.path)) {
          if (!tab.treeCache.has(item.path)) {
            loadDirectoryForTab(tab, item.path).then(renderTree);
          } else {
            renderDirectory(tab, item.path, depth + 1, container);
          }
        }
      } else {
        row.addEventListener('click', async (event) => {
          event.stopPropagation();
          setSelectedPath(tab, item.path);
          await editorService.openFile(item);
        });
      }

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // setSelectedPath() triggers a re-render, so resolve fresh DOM nodes after it runs.
        setSelectedPath(tab, item.path);
        let nextRow = null;
        let nextLabel = null;
        try {
          const rows = fileTree.querySelectorAll('.tree-row');
          for (const r of rows) {
            if (r && r.dataset && r.dataset.path === item.path) {
              nextRow = r;
              nextLabel = r.querySelector('.tree-label');
              break;
            }
          }
        } catch (err) { }
        showContextMenu(event.clientX, event.clientY, tab, item, nextRow || row, nextLabel || label);
      });

      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-target');
      });
      row.addEventListener('drop', async (event) => {
        event.preventDefault();
        row.classList.remove('drop-target');
        const tab = getActiveTab(state);
        if (!tab || !tab.connected) {
          persistenceService.setStatus('Not connected', true, tab);
          return;
        }
        if (tab.sessionType === 'local') {
          persistenceService.setStatus('Drag & drop upload unavailable for local session', true, tab);
          return;
        }
        const files = Array.from(event.dataTransfer.files || []);
        if (!files.length) return;
        const targetDir = item.type === 'd'
          ? item.path
          : normalizeForTab(tab, item.path).replace(/\/[^/]+$/, '') || '/';
        for (const file of files) {
          const remotePath = `${targetDir.replace(/\/$/, '')}/${file.name}`;
          const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (actionsBridge && actionsBridge.createTransferRow) {
            actionsBridge.createTransferRow(id, `Upload ${file.name}`);
          }
          const result = await state.api.upload(tab.id, { localPath: file.path, remotePath, id });
          if (result && result.ok) {
            actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'uploaded');
          } else {
            actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'error');
          }
        }
      });
    }

    if (sorted.length > end) {
      const moreRow = document.createElement('div');
      moreRow.className = 'tree-row tree-more';
      moreRow.style.paddingLeft = `${depth * 14}px`;
      moreRow.textContent = `... show next ${state.treePageSize}`;
      moreRow.addEventListener('click', (event) => {
        event.stopPropagation();
        tab.treePages.set(remotePath, page + 1);
        renderTree();
      });
      container.appendChild(moreRow);
    }
  }

  function renderPathList(container, items, options = {}) {
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-more';
      empty.textContent = 'None';
      container.appendChild(empty);
      return;
    }
    for (const entry of items) {
      const row = document.createElement('div');
      row.className = 'path-item';

      const button = document.createElement('button');
      button.className = 'path-btn';
      const pathStyle = options.pathStyle || 'posix';
      button.textContent = getPathLabel(entry, pathStyle);
      button.title = formatRemotePath(entry, pathStyle) || entry;
      button.addEventListener('click', () => {
        const tab = getActiveTab(state);
        setSelectedPath(tab, entry);
        navigateToPathForTab(tab, entry, { pushNav: true, recordRecent: true, clearCache: true });
      });
      row.appendChild(button);

      if (typeof options.onRemove === 'function') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'path-remove icon-btn';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove saved location';
        removeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          options.onRemove(entry);
        });
        row.appendChild(removeBtn);
      }

      container.appendChild(row);
    }
  }

  function renderSavedLocations() {
    if (!savedPaths) return;
    const tab = getActiveTab(state);
    if (!tab || !tab.host) {
      renderPathList(savedPaths, []);
      return;
    }
    const saved = persistenceService.getHostState(state.appState.savedLocations, tab.host);
    renderPathList(savedPaths, saved, {
      pathStyle: tab.remotePathStyle,
      onRemove: (entry) => {
        const next = saved.filter((item) => item !== entry);
        persistenceService.updateHostState('savedLocations', tab ? tab.host : '', next);
        renderSavedLocations();
      }
    });
  }

  function renderRecentLocations() {
    if (!recentPaths) return;
    const tab = getActiveTab(state);
    if (!tab || !tab.host) {
      renderPathList(recentPaths, []);
      return;
    }
    const recent = persistenceService.getHostState(state.appState.recentLocations, tab.host);
    renderPathList(recentPaths, recent, { pathStyle: tab.remotePathStyle });
  }

  function saveCurrentLocation() {
    const tab = getActiveTab(state);
    if (!tab || !tab.host || !tab.currentPath) {
      return;
    }
    const saved = persistenceService.getHostState(state.appState.savedLocations, tab.host);
    if (saved.includes(tab.currentPath)) {
      return;
    }
    const next = [tab.currentPath, ...saved];
    persistenceService.updateHostState('savedLocations', tab.host, next);
    renderSavedLocations();
  }

  function navigateHistory(direction) {
    const tab = getActiveTab(state);
    if (!tab) {
      return;
    }
    const nextIndex = tab.navIndex + direction;
    if (nextIndex < 0 || nextIndex >= tab.navHistory.length) {
      return;
    }
    tab.navIndex = nextIndex;
    const target = tab.navHistory[nextIndex];
    setSelectedPath(tab, target);
    navigateToPathForTab(tab, target, { pushNav: false, recordRecent: true, clearCache: true });
    updateNavButtons();
  }

  function bindEvents() {
    backButton.addEventListener('click', () => {
      const tab = getActiveTab(state);
      if (!tab || !tab.currentPath) return;
      const separator = tab.remotePathStyle === 'windows' ? '\\' : '/';
      const parts = tab.currentPath.split(separator).filter(Boolean);
      parts.pop();
      const parent = parts.length === 0 ? '/' : (tab.remotePathStyle === 'windows' ? parts.join(separator) : '/' + parts.join(separator));

      setSelectedPath(tab, parent);
      navigateToPathForTab(tab, parent, { pushNav: true, recordRecent: true, clearCache: true });
    });

    if (forwardButton) {
      forwardButton.style.display = 'none';
    }

    pathGoButton.addEventListener('click', () => {
      const tab = getActiveTab(state);
      setSelectedPath(tab, normalizeForTab(tab, pathInput.value));
      navigateToPathForTab(tab, pathInput.value, { pushNav: true, recordRecent: true, clearCache: true });
    });

    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const tab = getActiveTab(state);
        setSelectedPath(tab, normalizeForTab(tab, pathInput.value));
        navigateToPathForTab(tab, pathInput.value, { pushNav: true, recordRecent: true, clearCache: true });
      }
    });

    pathSaveButton.addEventListener('click', () => {
      saveCurrentLocation();
    });

    sectionHeaders.forEach((button) => {
      button.addEventListener('click', () => {
        toggleSection(button.dataset.section);
      });
    });
  }

  bindEvents();

  fileTree.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  fileTree.addEventListener('drop', async (event) => {
    event.preventDefault();
    const tab = getActiveTab(state);
    if (!tab || !tab.connected) {
      persistenceService.setStatus('Not connected', true, tab);
      return;
    }
    if (tab.sessionType === 'local') {
      persistenceService.setStatus('Drag & drop upload unavailable for local session', true, tab);
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    const targetDir = tab.treeRootPath || '/';
    for (const file of files) {
      const remotePath = `${targetDir.replace(/\/$/, '')}/${file.name}`;
      const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (actionsBridge && actionsBridge.createTransferRow) {
        actionsBridge.createTransferRow(id, `Upload ${file.name}`);
      }
      const result = await state.api.upload(tab.id, { localPath: file.path, remotePath, id });
      if (result && result.ok) {
        actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'uploaded');
      } else {
        actionsBridge && actionsBridge.markTransferComplete && actionsBridge.markTransferComplete(id, 'error');
      }
    }
  });

  return {
    updateNavButtons,
    updateTabPath,
    navigateToPathForTab,
    resetTreeForTab,
    loadDirectoryForTab,
    ensureTreeLoaded,
    renderTree,
    renderSavedLocations,
    renderRecentLocations,
    updateSectionUI,
    renderPathList,
    saveCurrentLocation,
    navigateHistory,
    setSelectedPath
  };
}
