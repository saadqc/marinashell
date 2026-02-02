import { getActiveTab, getTab } from '../state.js';

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  if (abs < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = abs / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const sign = n < 0 ? '-' : '';
  return `${sign}${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatRate(bytesPerSec) {
  if (bytesPerSec == null) return 'n/a';
  return `${formatBytes(bytesPerSec)}/s`;
}

function toneForPct(pct, warn, bad) {
  const p = clampPct(pct);
  if (p == null) return '';
  if (p >= bad) return 'bad';
  if (p >= warn) return 'warn';
  return 'good';
}

export function createStatusBar(state) {
  const el = state.elements.statusbar;
  if (!el) {
    return { render: () => { }, bind: () => { } };
  }

  function getDiskSelection(host) {
    const key = host || '';
    const map = state.appState && state.appState.diskMountSelection ? state.appState.diskMountSelection : null;
    if (!map || typeof map !== 'object') return '';
    return map[key] ? String(map[key]) : '';
  }

  function setDiskSelection(host, mount) {
    if (!state.appState || !state.api || !host) return;
    const current = state.appState.diskMountSelection && typeof state.appState.diskMountSelection === 'object'
      ? state.appState.diskMountSelection
      : {};
    const next = { ...current, [host]: mount || '' };
    state.appState = { ...state.appState, diskMountSelection: next };
    state.api.updateState({ diskMountSelection: next });
  }

  function formatDiskOptionLabel(disk) {
    const mount = disk && disk.mount ? String(disk.mount) : '';
    const fs = disk && disk.filesystem ? String(disk.filesystem) : '';
    if (!fs) return mount || 'unknown';
    const shortFs = fs.startsWith('/dev/') ? fs.slice(5) : fs;
    const compact = shortFs.length > 18 ? `${shortFs.slice(0, 15)}…` : shortFs;
    return mount ? `${mount} (${compact})` : compact;
  }

  function renderLucide() {
    const lucide = window.lucide;
    if (!lucide || typeof lucide.createIcons !== 'function') return;
    try {
      lucide.createIcons({
        root: el,
        nameAttr: 'data-icon',
        attrs: { width: '14', height: '14', 'stroke-width': '2.0' }
      });
    } catch (err) { }
  }

  function render() {
    const tab = getActiveTab(state);
    if (!tab) {
      el.innerHTML = `<div class="status-seg"><span class="status-dot"></span><strong>No session</strong></div>`;
      renderLucide();
      return;
    }

    const connected = Boolean(tab.connected);
    const label = tab.sessionType === 'local'
      ? 'local'
      : (tab.host ? `ssh:${tab.host}` : 'ssh:new');

    const metrics = tab.metrics || null;
    const cpuPct = metrics && metrics.cpuPct != null ? Number(metrics.cpuPct) : null;
    const memUsed = metrics && metrics.memUsed != null ? Number(metrics.memUsed) : null;
    const memTotal = metrics && metrics.memTotal != null ? Number(metrics.memTotal) : null;
    const diskUsed = metrics && metrics.diskUsed != null ? Number(metrics.diskUsed) : null;
    const diskTotal = metrics && metrics.diskTotal != null ? Number(metrics.diskTotal) : null;
    const diskMount = metrics && metrics.diskMount ? String(metrics.diskMount) : '';
    const disks = metrics && Array.isArray(metrics.disks) ? metrics.disks : [];
    const rxBps = metrics && metrics.rxBps != null ? Number(metrics.rxBps) : null;
    const txBps = metrics && metrics.txBps != null ? Number(metrics.txBps) : null;
    const user = metrics && metrics.user ? String(metrics.user) : '';
    const host = metrics && metrics.host ? String(metrics.host) : '';

    const memPct = memUsed != null && memTotal ? (memUsed / memTotal) * 100 : null;
    const diskPct = diskUsed != null && diskTotal ? (diskUsed / diskTotal) * 100 : null;
    const hostKey = tab.host || '';
    const selectedMount = getDiskSelection(hostKey) || diskMount || (disks[0] && disks[0].mount ? String(disks[0].mount) : '');
    const selectedDisk = disks.find((d) => String(d.mount || '') === selectedMount) || null;
    const selectedUsed = selectedDisk && selectedDisk.used != null ? Number(selectedDisk.used) : diskUsed;
    const selectedTotal = selectedDisk && selectedDisk.total != null ? Number(selectedDisk.total) : diskTotal;
    const selectedPct = selectedUsed != null && selectedTotal ? (selectedUsed / selectedTotal) * 100 : null;
    const diskText = selectedUsed != null && selectedTotal != null && selectedTotal > 0
      ? `${Math.round(selectedPct)}% ${formatBytes(selectedUsed)}/${formatBytes(selectedTotal)}`
      : 'n/a';

    const dotTone = connected ? 'good' : '';

    el.innerHTML = `
      <div class="status-seg">
        <span class="status-dot ${dotTone}"></span>
        <strong>${label}</strong>
        ${host && host !== (tab.host || '') ? `<span class="status-mono">${host}</span>` : ''}
      </div>
      <div class="status-seg">
        <span>CPU</span>
        <strong>${cpuPct != null ? `${Math.round(cpuPct)}%` : 'n/a'}</strong>
      </div>
      <div class="status-seg">
        <span>RAM</span>
        <strong>${memUsed != null && memTotal != null ? `${formatBytes(memUsed)} / ${formatBytes(memTotal)}` : 'n/a'}</strong>
      </div>
      <div class="status-seg">
        <span>NET</span>
        <strong><i data-icon="arrow-down"></i> ${formatRate(rxBps)} <i data-icon="arrow-up"></i> ${formatRate(txBps)}</strong>
      </div>
      <div class="status-seg" ${selectedMount ? `title="Mount: ${escapeHtml(selectedMount)}"` : ''}>
        <span>Disk</span>
        ${disks.length
        ? `<select class="status-select" data-disk-select data-host="${escapeHtml(hostKey)}" title="Select mount">
              ${disks.map((d) => {
          const mount = String(d.mount || '');
          const label = formatDiskOptionLabel(d);
          const selected = mount === selectedMount ? 'selected' : '';
          return `<option value="${escapeHtml(mount)}" ${selected}>${escapeHtml(label)}</option>`;
        }).join('')}
            </select>`
        : ''}
        <strong>${diskText}</strong>
      </div>
      <div class="spacer"></div>
      <div class="status-seg">
        <span>User</span>
        <strong class="status-mono">${user || 'n/a'}</strong>
      </div>
    `;

    // Color hints (CPU/RAM/Disk)
    const segs = el.querySelectorAll('.status-seg');
    // seg order: host, cpu, ram, net, disk, user
    const cpuSeg = segs[1];
    const ramSeg = segs[2];
    const diskSeg = segs[4];
    if (cpuSeg) cpuSeg.querySelector('.status-dot')?.remove();
    if (ramSeg) ramSeg.querySelector('.status-dot')?.remove();
    if (diskSeg) diskSeg.querySelector('.status-dot')?.remove();
    if (cpuSeg) cpuSeg.style.borderColor = cpuPct != null ? `rgba(255,255,255,${cpuPct >= 90 ? 0.22 : cpuPct >= 75 ? 0.16 : 0.10})` : '';
    if (ramSeg) ramSeg.style.borderColor = memPct != null ? `rgba(255,255,255,${memPct >= 90 ? 0.22 : memPct >= 75 ? 0.16 : 0.10})` : '';
    if (diskSeg) diskSeg.style.borderColor = selectedPct != null ? `rgba(255,255,255,${selectedPct >= 95 ? 0.22 : selectedPct >= 85 ? 0.16 : 0.10})` : '';
    renderLucide();
  }

  function bind() {
    if (state.api && typeof state.api.onSshMetrics === 'function') {
      state.api.onSshMetrics((payload) => {
        const tabId = payload && payload.tabId ? payload.tabId : null;
        if (!tabId) return;
        const tab = getTab(state, tabId);
        if (!tab) return;
        tab.metrics = payload && payload.connected ? payload : null;
        if (tabId === state.activeTabId) {
          render();
        }
      });
    }

    el.addEventListener('change', (event) => {
      const target = event && event.target ? event.target : null;
      const select = target && target.closest ? target.closest('select[data-disk-select]') : null;
      if (!select) return;
      const host = select.getAttribute('data-host') || '';
      const mount = select.value || '';
      setDiskSelection(host, mount);
      render();
    });

    window.addEventListener('marinashell:active-tab-changed', () => {
      render();
    });
    window.addEventListener('marinashell:session-state-changed', () => {
      render();
    });
  }

  return { render, bind };
}
