import { getActiveTab, getTab } from '../state.js';

export function createActionsPanel(state, persistenceService, filesPanel) {
  const {
    transferStatus,
    tunnelTypeSelect,
    tunnelSrcPortInput,
    tunnelDstInput,
    addTunnelButton,
    tunnelsList
  } = state.elements;


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

  function renderTunnels() {
    const list = document.getElementById('tunnels-list');
    if (!list) return;
    list.innerHTML = '';

    const tab = getActiveTab(state);
    if (!tab) {
      list.innerText = 'No active session';
      return;
    }

    const host = tab.host;
    const profiles = persistenceService.getTunnelProfiles(host);
    const activeTunnels = tab.activeTunnels || new Map();

    if (profiles.length === 0 && activeTunnels.size === 0) {
      list.innerText = 'No active tunnels';
    }

    const items = profiles.map((p, index) => {
      let activeId = null;
      let status = 'stopped';
      let error = null;

      for (const [id, tunnel] of activeTunnels.entries()) {
        if (tunnel.config.srcPort === p.srcPort && (tunnel.type === p.type || (p.type === 'local' && tunnel.config.dstPort === p.dstPort))) {
          activeId = id;
          status = tunnel.status || 'active';
          error = tunnel.error;
          break;
        }
      }
      return { ...p, index, isProfile: true, activeId, status, error };
    });

    for (const [id, tunnel] of activeTunnels.entries()) {
      const isProfile = items.some(it => it.activeId === id);
      if (!isProfile) {
        items.push({
          type: tunnel.type,
          srcPort: tunnel.config.srcPort,
          dstHost: tunnel.config.dstHost,
          dstPort: tunnel.config.dstPort,
          isProfile: false,
          activeId: id,
          status: tunnel.status || 'active',
          error: tunnel.error
        });
      }
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'command-row';

      const info = document.createElement('div');
      info.className = 'command-main';
      const title = document.createElement('div');
      title.className = 'command-title';
      title.style.display = 'flex';
      title.style.alignItems = 'center';

      const modeLabel = item.type === 'local' ? 'Local' : (item.type === 'remote' ? 'Remote' : 'Dynamic');

      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.marginRight = '8px';
      if (item.status === 'active' || item.status === 'ready') {
        dot.style.background = '#a6e3a1';
      } else if (item.status === 'error') {
        dot.style.background = '#f38ba8';
      } else {
        dot.style.background = '#585b70';
      }

      title.appendChild(dot);
      title.appendChild(document.createTextNode(`${modeLabel} ${item.srcPort}`));

      const sub = document.createElement('div');
      sub.className = 'command-sub';
      if (item.type === 'dynamic') {
        sub.textContent = 'SOCKS5 Proxy';
      } else {
        sub.textContent = `→ ${item.dstHost}:${item.dstPort}`;
      }
      if (item.error) {
        sub.textContent += ` (Error: ${item.error})`;
        sub.style.color = '#f38ba8';
      }

      info.appendChild(title);
      info.appendChild(sub);

      const actions = document.createElement('div');
      actions.className = 'command-actions';

      const toggleBtn = document.createElement('button');
      const isActive = item.status === 'active' || item.status === 'ready';
      toggleBtn.textContent = isActive ? 'Stop' : 'Start';

      toggleBtn.addEventListener('click', async () => {
        if (isActive && item.activeId) {
          await state.api.closeTunnel(tab.id, item.activeId);
          tab.activeTunnels.delete(item.activeId);
          renderTunnels();
        } else {
          if (!tab.connected) {
            persistenceService.setStatus('Not connected', true, tab);
            return;
          }
          persistenceService.setStatus(`Starting tunnel ${item.srcPort}...`, false, tab);
          const config = {
            srcPort: Number(item.srcPort),
            dstHost: item.dstHost,
            dstPort: Number(item.dstPort)
          };
          const result = await state.api.createTunnel({
            tabId: tab.id,
            type: item.type,
            config
          });
          if (result.ok) {
            tab.activeTunnels.set(result.id, {
              type: item.type,
              config,
              status: 'ready'
            });
            persistenceService.setStatus(`Tunnel ${item.srcPort} started`, false, tab);
          } else {
            persistenceService.setStatus(`Tunnel failed: ${result.error}`, true, tab);
          }
          renderTunnels();
        }
      });

      const delBtn = document.createElement('button');
      delBtn.innerHTML = '<i data-icon="x"></i>';
      delBtn.title = 'Remove saved profile';
      delBtn.addEventListener('click', () => {
        if (item.isProfile) {
          const nextProfiles = profiles.filter((_, i) => i !== item.index);
          persistenceService.saveTunnelProfiles(host, nextProfiles);
          renderTunnels();
        }
      });

      actions.appendChild(toggleBtn);
      if (item.isProfile) actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });
    renderLucide(list);
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

  function createTransferRow(id, label) {
    const tab = getActiveTab(state);
    if (!tab) return null;
    tab.latestTransferId = id;
    tab.latestTransferLabel = label;
    const row = document.createElement('div');
    row.className = 'transfer-row';
    row.dataset.id = id;
    row.innerHTML = `
      <div class="transfer-main">
        <span class="transfer-label"></span>
        <div class="transfer-bar"><div class="transfer-bar-fill"></div></div>
      </div>
      <span class="transfer-progress">0%</span>
    `;
    row.querySelector('.transfer-label').textContent = label;
    tab.transferRows.set(id, row);
    if (tab.id === state.activeTabId) {
      transferStatus?.prepend(row);
    }
    return row;
  }

  function updateTransferRowForTab(tabId, transferred, total, id) {
    const tab = getTab(state, tabId);
    if (!tab) return;
    const row = tab.transferRows.get(id);
    if (!row) return;
    const progress = row.querySelector('.transfer-progress');
    const fill = row.querySelector('.transfer-bar-fill');
    row.classList.remove('indeterminate');
    if (!total) {
      progress.textContent = `${formatBytes(transferred)} / ?`;
      if (fill) fill.style.width = '0%';
    } else {
      const percent = Math.min(100, Math.round((transferred / total) * 100));
      progress.textContent = `${percent}% · ${formatBytes(transferred)} / ${formatBytes(total)}`;
      if (fill) fill.style.width = `${percent}%`;
    }
    if (tabId === state.activeTabId && row.parentElement !== transferStatus) {
      renderTransfers();
    }
  }

  function updateTransferRowTextForTab(tabId, id, text) {
    const tab = getTab(state, tabId);
    if (!tab) return;
    const row = tab.transferRows.get(id);
    if (!row) return;
    const progress = row.querySelector('.transfer-progress');
    if (!progress) return;
    progress.textContent = String(text || '');
    row.classList.add('indeterminate');
    if (tabId === state.activeTabId && row.parentElement !== transferStatus) {
      renderTransfers();
    }
  }

  function markTransferComplete(id, text) {
    const tab = getActiveTab(state);
    if (!tab) return;
    const row = tab.transferRows.get(id);
    if (!row) return;
    const progress = row.querySelector('.transfer-progress');
    progress.textContent = text || 'done';
    row.classList.remove('indeterminate');
    row.classList.add('complete');
  }

  function renderTransfers() {
    if (!transferStatus) return;
    transferStatus.innerHTML = '';
    const tab = getActiveTab(state);
    if (!tab) return;
    for (const row of tab.transferRows.values()) {
      transferStatus.appendChild(row);
    }
  }

  function bindEvents() {
    if (tunnelTypeSelect) {
      tunnelTypeSelect.addEventListener('change', () => {
        const type = tunnelTypeSelect.value;
        if (tunnelDstInput) {
          tunnelDstInput.disabled = type === 'dynamic';
          tunnelDstInput.placeholder = type === 'dynamic' ? 'N/A' : 'Dst Host:Port';
        }
      });
    }

    if (addTunnelButton) {
      addTunnelButton.addEventListener('click', () => {
        const type = tunnelTypeSelect.value;
        const srcPort = tunnelSrcPortInput.value;
        const dstVal = tunnelDstInput.value;
        const tab = getActiveTab(state);

        if (!tab) return;
        if (!srcPort) {
          persistenceService.setStatus('Source port required', true, tab);
          return;
        }

        let dstHost = '127.0.0.1';
        let dstPort = 0;

        if (type !== 'dynamic') {
          if (!dstVal) {
            persistenceService.setStatus('Destination required', true, tab);
            return;
          }
          const parts = dstVal.split(':');
          if (parts.length === 2) {
            dstHost = parts[0];
            dstPort = Number(parts[1]);
          } else {
            dstPort = Number(parts[0]);
          }
        }

        const profile = {
          type,
          srcPort: Number(srcPort),
          dstHost,
          dstPort
        };

        const host = tab.host;
        if (host) {
          const profiles = persistenceService.getTunnelProfiles(host);
          profiles.push(profile);
          persistenceService.saveTunnelProfiles(host, profiles);
        }

        renderTunnels();
      });
    }
  }

  bindEvents();

  return {
    renderTunnels,
    renderTransfers,
    createTransferRow,
    markTransferComplete,
    updateTransferRowForTab,
    updateTransferRowTextForTab
  };
}
