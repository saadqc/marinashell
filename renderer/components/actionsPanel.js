import { getActiveTab, getTab } from '../state.js';

export function createActionsPanel(state, persistenceService, filesPanel) {
  const { transferStatus } = state.elements;

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

  return {
    renderTransfers,
    createTransferRow,
    markTransferComplete,
    updateTransferRowForTab,
    updateTransferRowTextForTab
  };
}
