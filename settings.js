(() => {
  const api = window.api;
  const statusEl = document.getElementById('settings-status');
  const editorMode = document.getElementById('editor-mode');
  const editorCommand = document.getElementById('editor-command');
  const editorLocalCommand = document.getElementById('editor-local-command');
  const editorUri = document.getElementById('editor-uri');
  const editorAssociations = document.getElementById('editor-associations');
  const treePageSize = document.getElementById('tree-page-size');
  const sessionTabTitleTemplate = document.getElementById('session-tab-title-template');
  const defaultTabColor = document.getElementById('default-tab-color');
  const sessionTabOverflow = document.getElementById('session-tab-overflow');
  const restoreTabs = document.getElementById('restore-tabs');
  const autoConnect = document.getElementById('auto-connect');
  const autoStartTunnels = document.getElementById('auto-start-tunnels');
  const localShellCommand = document.getElementById('local-shell-command');
  const localShellArgs = document.getElementById('local-shell-args');
  const localShellPathPrepend = document.getElementById('local-shell-path-prepend');
  const localShellMacPaths = document.getElementById('local-shell-mac-paths');
  const enableDockerRpc = document.getElementById('enable-docker-rpc');
  const shortcutNewTab = document.getElementById('shortcut-new-tab');
  const shortcutCloseTab = document.getElementById('shortcut-close-tab');

  let settings = null;
  let saveTimer = null;

  function syncEditorPluginAvailability(list) {
    const option = editorMode.querySelector('[data-plugin-editor="true"]');
    if (!option) return;
    const plugin = Array.isArray(list) ? list.find((item) => item && item.editorMode === 'inline-editor') : null;
    const disabledList = readList(['plugins', 'disabled', 'list'], []);
    const enabled = Boolean(plugin) && !disabledList.includes(plugin.id);
    option.disabled = !enabled;
    option.textContent = enabled
      ? 'Inline editor (CodeMirror)'
      : 'Inline editor (enable CodeMirror Editor plugin)';
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function readValue(path, fallback) {
    const [category, subcategory, field] = path;
    const node = settings && settings[category] && settings[category][subcategory] && settings[category][subcategory][field];
    if (node && Object.prototype.hasOwnProperty.call(node, 'value')) {
      return node.value;
    }
    return fallback;
  }

  function readList(path, fallback) {
    const value = readValue(path, fallback);
    return Array.isArray(value) ? value : fallback;
  }

  function writeValue(path, type, value) {
    const [category, subcategory, field] = path;
    if (!settings[category]) settings[category] = {};
    if (!settings[category][subcategory]) settings[category][subcategory] = {};
    settings[category][subcategory][field] = { type, value };
  }

  function scheduleSave() {
    setStatus('Saving...');
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(async () => {
      try {
        const updated = await api.updateSettings(settings);
        settings = updated || settings;
        setStatus('Saved');
      } catch (err) {
        setStatus('Save failed', true);
      }
    }, 300);
  }

  function bindInputs() {
    editorMode.addEventListener('change', () => {
      writeValue(['editor', 'open', 'mode'], 'string', editorMode.value);
      scheduleSave();
    });
    editorCommand.addEventListener('input', () => {
      writeValue(['editor', 'open', 'commandTemplate'], 'string', editorCommand.value);
      scheduleSave();
    });
    editorLocalCommand.addEventListener('input', () => {
      writeValue(['editor', 'open', 'localCommandTemplate'], 'string', editorLocalCommand.value);
      scheduleSave();
    });
    editorUri.addEventListener('input', () => {
      writeValue(['editor', 'open', 'sftpUriTemplate'], 'string', editorUri.value);
      scheduleSave();
    });
    editorAssociations.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(editorAssociations.value || '[]');
        if (!Array.isArray(parsed)) {
          throw new Error('Associations must be an array');
        }
        writeValue(['editor', 'associations', 'list'], 'array', parsed);
        setStatus('Saving...');
        scheduleSave();
      } catch (err) {
        setStatus('Invalid JSON for associations', true);
      }
    });
    treePageSize.addEventListener('input', () => {
      const parsed = Number(treePageSize.value);
      writeValue(['ui', 'tree', 'pageSize'], 'number', Number.isNaN(parsed) ? 500 : parsed);
      scheduleSave();
    });
    if (sessionTabTitleTemplate) {
      sessionTabTitleTemplate.addEventListener('input', () => {
        writeValue(['ui', 'session', 'tabTitleTemplate'], 'string', sessionTabTitleTemplate.value);
        scheduleSave();
      });
    }
    if (defaultTabColor) {
      defaultTabColor.addEventListener('change', () => {
        writeValue(['ui', 'session', 'defaultTabColor'], 'string', defaultTabColor.value);
        scheduleSave();
      });
    }
    sessionTabOverflow.addEventListener('change', () => {
      writeValue(['ui', 'session', 'tabOverflow'], 'string', sessionTabOverflow.value);
      scheduleSave();
    });
    restoreTabs.addEventListener('change', () => {
      writeValue(['ui', 'session', 'restoreTabs'], 'boolean', restoreTabs.checked);
      scheduleSave();
    });
    autoConnect.addEventListener('change', () => {
      writeValue(['ui', 'connection', 'autoConnectOnSelect'], 'boolean', autoConnect.checked);
      scheduleSave();
    });
    if (autoStartTunnels) {
      autoStartTunnels.addEventListener('change', () => {
        writeValue(['ui', 'connection', 'autoStartTunnels'], 'boolean', autoStartTunnels.checked);
        scheduleSave();
      });
    }
    localShellCommand.addEventListener('input', () => {
      writeValue(['shell', 'local', 'command'], 'string', localShellCommand.value.trim());
      scheduleSave();
    });
    localShellArgs.addEventListener('input', () => {
      writeValue(['shell', 'local', 'args'], 'string', localShellArgs.value.trim());
      scheduleSave();
    });
    localShellPathPrepend.addEventListener('input', () => {
      writeValue(['shell', 'local', 'pathPrepend'], 'string', localShellPathPrepend.value.trim());
      scheduleSave();
    });
    localShellMacPaths.addEventListener('change', () => {
      writeValue(['shell', 'local', 'injectMacPaths'], 'boolean', localShellMacPaths.checked);
      scheduleSave();
    });
    enableDockerRpc.addEventListener('change', () => {
      writeValue(['plugins', 'docker', 'enableRpc'], 'boolean', enableDockerRpc.checked);
      scheduleSave();
    });
    shortcutNewTab.addEventListener('input', () => {
      writeValue(['ui', 'shortcuts', 'newTab'], 'string', shortcutNewTab.value.trim());
      scheduleSave();
    });
    shortcutCloseTab.addEventListener('input', () => {
      writeValue(['ui', 'shortcuts', 'closeTab'], 'string', shortcutCloseTab.value.trim());
      scheduleSave();
    });
  }

  function renderPlugins(list) {
    const container = document.getElementById('plugin-list');
    container.innerHTML = '';

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="hint">No plugins installed.</div>';
      return;
    }

    list.forEach(p => {
      const disabledList = readList(['plugins', 'disabled', 'list'], []);
      const isEnabled = p.enabled !== false;

      const el = document.createElement('div');
      el.style.background = '#141a26';
      el.style.padding = '8px';
      el.style.borderRadius = '6px';
      el.style.border = '1px solid #2a2f3a';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.gap = '10px';

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.fontSize = '13px';
      title.textContent = p.id;

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';

      const enabledWrap = document.createElement('div');
      enabledWrap.style.display = 'flex';
      enabledWrap.style.alignItems = 'center';
      enabledWrap.style.gap = '6px';
      enabledWrap.style.color = '#b5bfcc';
      enabledWrap.style.fontSize = '11px';

      const enabledLabel = document.createElement('label');
      enabledLabel.textContent = 'Enabled';
      enabledLabel.style.margin = '0';
      enabledLabel.style.cursor = 'pointer';

      const enabledToggle = document.createElement('input');
      enabledToggle.type = 'checkbox';
      enabledToggle.checked = isEnabled;
      enabledToggle.style.width = 'auto';
      enabledToggle.style.margin = '0';
      enabledToggle.style.cursor = 'pointer';

      let defaultButton = null;
      if (p.editorMode) {
        defaultButton = document.createElement('button');
        defaultButton.type = 'button';
        defaultButton.style.width = 'auto';
        defaultButton.style.padding = '4px 8px';
        defaultButton.style.fontSize = '10px';
        defaultButton.disabled = !isEnabled || editorMode.value === p.editorMode;
        defaultButton.textContent = editorMode.value === p.editorMode ? 'Default editor' : 'Use as default';
        defaultButton.addEventListener('click', () => {
          if (!enabledToggle.checked) return;
          editorMode.value = p.editorMode;
          writeValue(['editor', 'open', 'mode'], 'string', p.editorMode);
          defaultButton.disabled = true;
          defaultButton.textContent = 'Default editor';
          scheduleSave();
        });
      }

      enabledToggle.addEventListener('change', () => {
        const current = readList(['plugins', 'disabled', 'list'], []);
        const set = new Set(current);
        if (enabledToggle.checked) {
          set.delete(p.id);
        } else {
          set.add(p.id);
        }
        writeValue(['plugins', 'disabled', 'list'], 'array', Array.from(set));
        const enabledIds = new Set(readList(['plugins', 'enabled', 'list'], []));
        if (enabledToggle.checked) enabledIds.add(p.id); else enabledIds.delete(p.id);
        writeValue(['plugins', 'enabled', 'list'], 'array', Array.from(enabledIds));
        if (defaultButton) {
          defaultButton.disabled = !enabledToggle.checked || editorMode.value === p.editorMode;
        }
        syncEditorPluginAvailability(list);
        scheduleSave();
      });

      enabledLabel.addEventListener('click', () => {
        enabledToggle.checked = !enabledToggle.checked;
        enabledToggle.dispatchEvent(new Event('change'));
      });

      enabledWrap.appendChild(enabledLabel);
      enabledWrap.appendChild(enabledToggle);

      const badge = document.createElement('span');
      badge.style.fontSize = '10px';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      badge.style.background = p.source === 'bundled' ? '#2a2f3a' : '#1e3a5f';
      badge.textContent = p.source;

      if (defaultButton) right.appendChild(defaultButton);
      right.appendChild(enabledWrap);
      right.appendChild(badge);

      header.appendChild(title);
      header.appendChild(right);
      el.appendChild(header);

      if (p.description) {
        const desc = document.createElement('div');
        desc.style.fontSize = '11px';
        desc.style.color = '#7c8796';
        desc.style.marginTop = '4px';
        desc.textContent = p.description;
        el.appendChild(desc);
      }

      if (p.error) {
        const err = document.createElement('div');
        err.style.color = '#f38ba8';
        err.style.fontSize = '11px';
        err.style.marginTop = '4px';
        err.textContent = `Error: ${p.error}`;
        el.appendChild(err);
      }

      if (!isEnabled) {
        const hint = document.createElement('div');
        hint.style.fontSize = '11px';
        hint.style.color = '#7c8796';
        hint.style.marginTop = '6px';
        hint.textContent = 'Disabled (takes effect immediately).';
        el.appendChild(hint);
      }

      container.appendChild(el);
    });
  }

  async function loadPlugins() {
    if (!api.getPlugins) return;
    try {
      const plugins = await api.getPlugins();
      syncEditorPluginAvailability(plugins);
      renderPlugins(plugins);
    } catch (err) {
      console.error('Failed to load plugins', err);
    }
  }

  const pluginInstallBtn = document.getElementById('plugin-install-btn');
  const pluginInstallUrl = document.getElementById('plugin-install-url');

  if (pluginInstallBtn && pluginInstallUrl) {
    pluginInstallBtn.addEventListener('click', async () => {
      const url = pluginInstallUrl.value.trim();
      if (!url) return;

      pluginInstallBtn.disabled = true;
      pluginInstallBtn.textContent = 'Installing...';
      try {
        const res = await api.installPlugin(url);
        if (res.ok) {
          pluginInstallUrl.value = '';
          setStatus('Plugin installed!');
          await loadPlugins();
        } else {
          setStatus(`Install failed: ${res.error}`, true);
        }
      } catch (err) {
        setStatus(`Install failed: ${err.message}`, true);
      } finally {
        pluginInstallBtn.disabled = false;
        pluginInstallBtn.textContent = 'Install';
      }
    });
  }

  async function init() {
    if (!api) {
      setStatus('IPC unavailable', true);
      return;
    }
    try {
      settings = await api.getSettings();
      editorMode.value = readValue(['editor', 'open', 'mode'], 'remote-shell');
      editorCommand.value = readValue(['editor', 'open', 'commandTemplate'], 'nano {escapedPath}');
      editorLocalCommand.value = readValue(['editor', 'open', 'localCommandTemplate'], 'code --reuse-window {path}');
      editorUri.value = readValue(['editor', 'open', 'sftpUriTemplate'], 'sftp://{user}@{host}:{port}{path}');
      editorAssociations.value = JSON.stringify(
        readList(['editor', 'associations', 'list'], []),
        null,
        2
      );
      treePageSize.value = readValue(['ui', 'tree', 'pageSize'], 500);
      if (sessionTabTitleTemplate) {
        sessionTabTitleTemplate.value = readValue(
          ['ui', 'session', 'tabTitleTemplate'],
          '<ssh_machine>:<current_folder_name[:15]>'
        );
      }
      if (defaultTabColor) {
        defaultTabColor.value = readValue(['ui', 'session', 'defaultTabColor'], 'default');
      }
      sessionTabOverflow.value = readValue(['ui', 'session', 'tabOverflow'], 'scroll') === 'wrap' ? 'wrap' : 'scroll';
      restoreTabs.checked = Boolean(readValue(['ui', 'session', 'restoreTabs'], false));
      autoConnect.checked = Boolean(readValue(['ui', 'connection', 'autoConnectOnSelect'], false));
      if (autoStartTunnels) {
        autoStartTunnels.checked = Boolean(readValue(['ui', 'connection', 'autoStartTunnels'], true));
      }
      localShellCommand.value = readValue(['shell', 'local', 'command'], '');
      localShellArgs.value = readValue(['shell', 'local', 'args'], '');
      localShellPathPrepend.value = readValue(['shell', 'local', 'pathPrepend'], '');
      localShellMacPaths.checked = Boolean(readValue(['shell', 'local', 'injectMacPaths'], true));
      // Load docker RPC setting
      enableDockerRpc.checked = Boolean(readValue(['plugins', 'docker', 'enableRpc'], false));
      shortcutNewTab.value = readValue(['ui', 'shortcuts', 'newTab'], 'mod+t');
      shortcutCloseTab.value = readValue(['ui', 'shortcuts', 'closeTab'], 'mod+w');
      bindInputs();

      // Load plugins
      loadPlugins();
    } catch (err) {
      setStatus('Failed to load settings', true);
    }
  }

  init();
})();
