function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLucide(root) {
  const lucide = window.lucide;
  if (!lucide || typeof lucide.createIcons !== 'function') return;
  try {
    lucide.createIcons({
      root: root || document,
      nameAttr: 'data-icon',
      attrs: { width: '16', height: '16', 'stroke-width': '1.9' }
    });
  } catch (err) { }
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesSearch(haystack, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(haystack).includes(q);
}

function formatStatus(state, statusText) {
  const s = String(state || '').toLowerCase();
  if (s === 'running') return { label: statusText || 'Running', tone: 'good' };
  if (s === 'paused') return { label: statusText || 'Paused', tone: 'warn' };
  if (s === 'restarting') return { label: statusText || 'Restarting', tone: 'warn' };
  if (s === 'dead') return { label: statusText || 'Dead', tone: 'bad' };
  return { label: statusText || state || 'Stopped', tone: 'neutral' };
}

function injectStyles() {
  if (document.getElementById('docker-plugin-style')) return;
  const style = document.createElement('style');
  style.id = 'docker-plugin-style';
  style.textContent = `
    .docker-plugin {
      --dock-bg: rgba(20, 26, 38, 0.55);
      --dock-surface: rgba(15, 19, 32, 0.9);
      --dock-border: rgba(255, 255, 255, 0.08);
      --dock-border-strong: rgba(255, 255, 255, 0.14);
      --dock-text: rgba(255, 255, 255, 0.92);
      --dock-muted: rgba(255, 255, 255, 0.56);
      --dock-accent: #39a2ff;
      --dock-good: #a6e3a1;
      --dock-warn: #f9e2af;
      --dock-bad: #f38ba8;
      --dock-cyan: #74c7ec;
      --dock-purple: #cba6f7;

      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      color: var(--dock-text);
      box-sizing: border-box;
      min-height: 0;
    }

    .docker-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--dock-border);
      background: var(--dock-bg);
      border-radius: 12px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .docker-segment {
      display: inline-flex;
      border: 1px solid var(--dock-border);
      background: rgba(15, 19, 32, 0.65);
      border-radius: 10px;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .docker-segment button {
      background: transparent;
      border: 0;
      color: var(--dock-muted);
      padding: 7px 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      user-select: none;
      border-right: 1px solid var(--dock-border);
    }
    .docker-segment button:last-child { border-right: 0; }
    .docker-segment button:hover { color: var(--dock-text); background: rgba(255,255,255,0.04); }
    .docker-segment button.active { color: #fff; background: rgba(57, 162, 255, 0.18); }

    .docker-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid var(--dock-border);
      color: var(--dock-muted);
      font-size: 11px;
      line-height: 18px;
    }

    .docker-right {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 240px;
      justify-content: flex-end;
    }

    .docker-search {
      position: relative;
      width: min(360px, 34vw);
    }
    .docker-search input {
      width: 100%;
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid var(--dock-border);
      color: var(--dock-text);
      padding: 8px 10px 8px 28px;
      border-radius: 10px;
      font-size: 12px;
      outline: none;
    }
    .docker-search input::placeholder { color: rgba(255,255,255,0.38); }
    .docker-search input:focus { border-color: rgba(57,162,255,0.55); box-shadow: 0 0 0 3px rgba(57,162,255,0.12); }
    .docker-search .icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: rgba(255,255,255,0.42);
      width: 14px;
      height: 14px;
      pointer-events: none;
    }

    .docker-iconbtn {
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid var(--dock-border);
      color: var(--dock-muted);
      width: 34px;
      height: 34px;
      border-radius: 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      font-size: 14px;
    }
    .docker-iconbtn:hover { color: var(--dock-text); border-color: var(--dock-border-strong); }
    .docker-iconbtn svg.lucide { width: 16px; height: 16px; }

    .docker-error {
      padding: 10px 12px;
      border: 1px solid rgba(243, 139, 168, 0.25);
      background: rgba(243, 139, 168, 0.08);
      color: var(--dock-bad);
      border-radius: 10px;
      white-space: pre-wrap;
    }

    .docker-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--dock-border);
      background: var(--dock-surface);
      border-radius: 12px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.22);
    }

    .docker-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .docker-table th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--dock-border);
      color: rgba(255,255,255,0.58);
      position: sticky;
      top: 0;
      background: rgba(15, 19, 32, 0.98);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 1;
    }
    .docker-table td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      vertical-align: middle;
      color: rgba(255,255,255,0.86);
    }
    .docker-table tr:hover td { background: rgba(255,255,255,0.03); }

    .docker-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .docker-muted { color: var(--dock-muted); }
    .docker-ellipsis { display: inline-block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    .docker-cell {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .docker-cell-title {
      font-weight: 600;
      color: rgba(255,255,255,0.9);
      min-width: 0;
    }
    .docker-cell-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      min-width: 0;
    }

    .docker-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--dock-border);
      font-size: 12px;
      color: rgba(255,255,255,0.82);
      background: rgba(255,255,255,0.03);
      max-width: 100%;
    }
    .docker-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 99px;
      background: rgba(255,255,255,0.35);
      box-shadow: 0 0 0 3px rgba(255,255,255,0.06);
    }
    .docker-pill.good .dot { background: var(--dock-good); box-shadow: 0 0 0 3px rgba(166,227,161,0.14); }
    .docker-pill.warn .dot { background: var(--dock-warn); box-shadow: 0 0 0 3px rgba(249,226,175,0.14); }
    .docker-pill.bad .dot { background: var(--dock-bad); box-shadow: 0 0 0 3px rgba(243,139,168,0.14); }

    .docker-actions { display: inline-flex; gap: 6px; align-items: center; }
    .docker-action {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--dock-border);
      color: rgba(255,255,255,0.84);
      width: 28px;
      height: 28px;
      border-radius: 9px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      font-size: 0;
    }
    .docker-action svg.lucide { width: 16px; height: 16px; }
    .docker-action:hover { border-color: var(--dock-border-strong); background: rgba(255,255,255,0.06); }
    .docker-action:disabled { opacity: 0.45; cursor: default; }
    .docker-action:disabled:hover { border-color: var(--dock-border); background: rgba(255,255,255,0.03); }

    .docker-action.good { color: var(--dock-good); border-color: rgba(166,227,161,0.22); }
    .docker-action.good:hover { border-color: rgba(166,227,161,0.55); }
    .docker-action.warn { color: var(--dock-warn); border-color: rgba(249,226,175,0.22); }
    .docker-action.warn:hover { border-color: rgba(249,226,175,0.55); }
    .docker-action.info { color: var(--dock-accent); border-color: rgba(57,162,255,0.22); }
    .docker-action.info:hover { border-color: rgba(57,162,255,0.55); }
    .docker-action.cyan { color: var(--dock-cyan); border-color: rgba(116,199,236,0.22); }
    .docker-action.cyan:hover { border-color: rgba(116,199,236,0.55); }
    .docker-action.purple { color: var(--dock-purple); border-color: rgba(203,166,247,0.22); }
    .docker-action.purple:hover { border-color: rgba(203,166,247,0.55); }
    .docker-action.danger { color: var(--dock-bad); border-color: rgba(243, 139, 168, 0.25); }
    .docker-action.danger:hover { border-color: rgba(243, 139, 168, 0.6); }

    .docker-empty { padding: 22px 16px; color: rgba(255,255,255,0.58); }
    .docker-empty .h { color: rgba(255,255,255,0.86); font-weight: 650; margin-bottom: 6px; }
    .docker-empty .sub { max-width: 520px; line-height: 1.45; }

    .docker-toast {
      position: absolute;
      left: 50%;
      top: 14px;
      transform: translateX(-50%);
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid var(--dock-border);
      background: rgba(15, 19, 32, 0.92);
      color: rgba(255,255,255,0.86);
      font-size: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.28);
      z-index: 30;
      display: none;
      max-width: min(520px, 92%);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .docker-modal {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(8, 12, 18, 0.7);
      z-index: 40;
      padding: 16px;
    }
    .docker-modal.open { display: flex; }
    .docker-modal-card {
      width: min(920px, 96%);
      height: min(640px, 92%);
      background: rgba(15, 19, 32, 0.96);
      border: 1px solid var(--dock-border);
      border-radius: 12px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.45);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .docker-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      background: rgba(20, 26, 38, 0.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .docker-modal-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .docker-modal-title .h { font-size: 12px; font-weight: 650; color: rgba(255,255,255,0.92); }
    .docker-modal-title .sub { font-size: 11px; color: rgba(255,255,255,0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; }
    .docker-modal-actions { display: flex; gap: 8px; align-items: center; }
    .docker-modal-actions input {
      width: 90px;
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid var(--dock-border);
      color: var(--dock-text);
      padding: 7px 8px;
      border-radius: 10px;
      font-size: 12px;
      outline: none;
    }
    .docker-toggle {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: rgba(255,255,255,0.75);
      user-select: none;
    }
    .docker-toggle input { width: auto; }
    .docker-modal-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 10px 12px;
    }
    .docker-logbox {
      white-space: pre;
      font-size: 12px;
      line-height: 1.45;
      color: rgba(255,255,255,0.86);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    .docker-shellbox {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--dock-border);
      background: rgba(15, 19, 32, 0.65);
      border-radius: 12px;
    }

    .docker-shellbox .hint {
      color: rgba(255,255,255,0.62);
      font-size: 12px;
      line-height: 1.45;
    }

    .docker-code {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(11, 14, 20, 0.55);
      color: rgba(255,255,255,0.90);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
    }
  `;
  document.head.appendChild(style);
}

function renderEmpty(title, subtitle) {
  return `
    <div class="docker-empty">
      <div class="h">${escapeHtml(title || 'Nothing to show')}</div>
      <div class="sub">${escapeHtml(subtitle || '')}</div>
    </div>
  `;
}

function renderTable(data, columns) {
  if (!data || !data.length) {
    return renderEmpty('Nothing to show', 'No results for the current view and search query.');
  }
  const headers = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const rows = data.map((row) => {
    const cells = columns.map((c) => `<td>${c.getHtml(row)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="docker-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

export default function (context) {
  const { registerView, registerTab, api, state } = context;

  const register = typeof registerView === 'function'
    ? registerView
    : (id, info) => {
      if (typeof registerTab !== 'function') return;
      registerTab(id, info.title || id, (panel) => info.mount(panel));
    };

  register('docker', {
    title: 'Docker',
    iconClass: 'icon-docker',
    supports: ['ssh', 'local'],
    mount: (container, options = {}) => {
      injectStyles();
      const prevOverflow = container.style.overflow;
      container.style.overflow = 'hidden';

      let initialized = false;
      let activeView = 'containers';
      let searchQuery = '';
      let counts = { containers: 0, images: 0, volumes: 0, networks: 0, compose: 0 };
      let cache = { containers: null, images: null, volumes: null, networks: null, compose: null };
      let searchTimer = null;
      let toastTimer = null;

      const logsState = {
        open: false,
        containerId: '',
        containerName: '',
        tail: 200,
        auto: true,
        timer: null,
        inFlight: false,
        requestToken: 0
      };

      const shellState = {
        open: false,
        containerId: '',
        containerName: '',
        command: '',
        openInNewTab: true,
        openDetached: true,
        inFlight: false
      };

      const abort = new AbortController();
      const on = (el, event, handler) => el.addEventListener(event, handler, { signal: abort.signal });

      async function invoke(channel, payload) {
        return api.invoke(`plugin:docker:${channel}`, payload);
      }

      async function ensureInit(tabId) {
        if (initialized) return true;
        const res = await invoke('init', { tabId });
        if (!res.ok) throw new Error(res.error || 'Failed to initialize Docker plugin');
        initialized = true;
        return true;
      }

      async function fetchView(tabId, view) {
        if (view === 'containers') {
          const res = await invoke('listContainers', { tabId });
          if (!res.ok) throw new Error(res.error || 'Failed to list containers');
          return res.data || [];
        }
        if (view === 'images') {
          const res = await invoke('listImages', { tabId });
          if (!res.ok) throw new Error(res.error || 'Failed to list images');
          return res.data || [];
        }
        if (view === 'volumes') {
          const res = await invoke('listVolumes', { tabId });
          if (!res.ok) throw new Error(res.error || 'Failed to list volumes');
          return res.data || [];
        }
        if (view === 'networks') {
          const res = await invoke('listNetworks', { tabId });
          if (!res.ok) throw new Error(res.error || 'Failed to list networks');
          return res.data || [];
        }
        if (view === 'compose') {
          const res = await invoke('listCompose', { tabId });
          if (!res.ok) throw new Error(res.error || 'Failed to list compose projects');
          return res.data || [];
        }
        return [];
      }

      function setBadges(root) {
        root.querySelectorAll('[data-badge]').forEach((el) => {
          const key = el.getAttribute('data-badge');
          el.textContent = String(counts[key] || 0);
        });
      }

      function setActiveSegment(root) {
        root.querySelectorAll('button[data-view]').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-view') === activeView);
        });
      }

      function setError(root, message) {
        const el = root.querySelector('#docker-error');
        if (!el) return;
        if (!message) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        el.style.display = 'block';
        el.textContent = message;
      }

      function render(root) {
        root.innerHTML = `
          <div class="docker-plugin">
            <div class="docker-toast" id="docker-toast"></div>
            <div class="docker-topbar">
              <div class="docker-segment" role="tablist" aria-label="Docker views">
                <button data-view="containers" role="tab">Containers <span class="docker-badge" data-badge="containers">0</span></button>
                <button data-view="images" role="tab">Images <span class="docker-badge" data-badge="images">0</span></button>
                <button data-view="volumes" role="tab">Volumes <span class="docker-badge" data-badge="volumes">0</span></button>
                <button data-view="networks" role="tab">Networks <span class="docker-badge" data-badge="networks">0</span></button>
                <button data-view="compose" role="tab">Compose <span class="docker-badge" data-badge="compose">0</span></button>
              </div>
              <div class="docker-right">
                <div class="docker-search">
                  <i class="icon" data-icon="search"></i>
                  <input id="docker-search" type="text" placeholder="Search…" value="${escapeHtml(searchQuery)}" />
                </div>
                <button class="docker-iconbtn" data-action="refresh" title="Refresh"><i data-icon="refresh-cw"></i></button>
              </div>
            </div>
            <div id="docker-error" class="docker-error" style="display:none"></div>
            <div class="docker-content" id="docker-content">${renderEmpty('Loading…', 'Fetching data from the remote host.')}</div>

            <div class="docker-modal" id="docker-logs-modal">
              <div class="docker-modal-card" role="dialog" aria-modal="true">
                <div class="docker-modal-header">
                  <div class="docker-modal-title">
                    <div class="h">Container logs</div>
                    <div class="sub" id="docker-logs-subtitle"></div>
                  </div>
                  <div class="docker-modal-actions">
                    <input id="docker-logs-tail" type="number" min="10" max="5000" step="10" title="Tail lines" />
                    <label class="docker-toggle">
                      <input id="docker-logs-auto" type="checkbox" />
                      <span>Auto</span>
                    </label>
                    <button class="docker-iconbtn" data-action="logs-refresh" title="Refresh"><i data-icon="refresh-cw"></i></button>
                    <button class="docker-iconbtn" data-action="logs-close" title="Close"><i data-icon="x"></i></button>
                  </div>
                </div>
                <div class="docker-modal-body">
                  <div class="docker-logbox" id="docker-logs-box"></div>
                </div>
              </div>
            </div>

            <div class="docker-modal" id="docker-shell-modal">
              <div class="docker-modal-card" role="dialog" aria-modal="true">
                <div class="docker-modal-header">
                  <div class="docker-modal-title">
                    <div class="h">Container shell</div>
                    <div class="sub" id="docker-shell-subtitle"></div>
                  </div>
                  <div class="docker-modal-actions">
                    <label class="docker-toggle">
                      <input id="docker-shell-newtab" type="checkbox" />
                      <span>New tab</span>
                    </label>
                    <label class="docker-toggle">
                      <input id="docker-shell-detached" type="checkbox" />
                      <span>Detached</span>
                    </label>
                    <button class="docker-iconbtn" data-action="shell-copy" title="Copy"><i data-icon="copy"></i></button>
                    <button class="docker-iconbtn" data-action="shell-open" title="Open"><i data-icon="terminal"></i></button>
                    <button class="docker-iconbtn" data-action="shell-close" title="Close"><i data-icon="x"></i></button>
                  </div>
                </div>
                <div class="docker-modal-body">
                  <div class="docker-shellbox">
                    <div class="hint">Opens an interactive shell via <span class="docker-mono">docker exec -it</span>. Works only for running containers.</div>
                    <pre class="docker-code" id="docker-shell-command"></pre>
                    <div class="docker-error" id="docker-shell-error" style="display:none"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;

        setBadges(root);
        setActiveSegment(root);
        renderLucide(root);
      }

      function showToast(root, text, ms = 1600) {
        const el = root.querySelector('#docker-toast');
        if (!el) return;
        el.textContent = text || '';
        el.style.display = text ? 'block' : 'none';
        if (toastTimer) clearTimeout(toastTimer);
        if (text) {
          toastTimer = setTimeout(() => {
            el.style.display = 'none';
            el.textContent = '';
          }, ms);
        }
      }

      async function openLogs(root, { id, name }) {
        logsState.open = true;
        logsState.containerId = id || '';
        logsState.containerName = name || '';

        const modal = root.querySelector('#docker-logs-modal');
        const subtitle = root.querySelector('#docker-logs-subtitle');
        const tailInput = root.querySelector('#docker-logs-tail');
        const autoInput = root.querySelector('#docker-logs-auto');

        if (subtitle) subtitle.textContent = `${logsState.containerName || ''} ${logsState.containerId ? `(${logsState.containerId.slice(0, 12)})` : ''}`.trim();
        if (tailInput) tailInput.value = String(logsState.tail);
        if (autoInput) autoInput.checked = Boolean(logsState.auto);

        if (modal) modal.classList.add('open');
        await refreshLogs(root);
        scheduleLogs(root);
        renderLucide(root);
      }

      async function openShell(root, { id, name }) {
        const tabId = state.activeTabId;
        if (!tabId) return;
        shellState.open = true;
        shellState.containerId = id || '';
        shellState.containerName = name || '';
        shellState.command = '';

        const modal = root.querySelector('#docker-shell-modal');
        const subtitle = root.querySelector('#docker-shell-subtitle');
        const cmdEl = root.querySelector('#docker-shell-command');
        const errorEl = root.querySelector('#docker-shell-error');
        const newTab = root.querySelector('#docker-shell-newtab');
        const detached = root.querySelector('#docker-shell-detached');

        if (subtitle) subtitle.textContent = `${shellState.containerName || ''} ${shellState.containerId ? `(${shellState.containerId.slice(0, 12)})` : ''}`.trim();
        if (cmdEl) cmdEl.textContent = 'Loading...';
        if (newTab) newTab.checked = Boolean(shellState.openInNewTab);
        if (detached) detached.checked = Boolean(shellState.openDetached);
        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        if (modal) modal.classList.add('open');
        renderLucide(root);

        if (shellState.inFlight) return;
        shellState.inFlight = true;
        try {
          const res = await invoke('containerShell', { tabId, id: shellState.containerId });
          if (!res || !res.ok) {
            const msg = res && res.error ? res.error : 'Failed to prepare shell';
            if (cmdEl) cmdEl.textContent = '';
            if (errorEl) {
              errorEl.style.display = 'block';
              errorEl.textContent = msg;
            }
            return;
          }
          shellState.command = res.command || '';
          if (cmdEl) cmdEl.textContent = shellState.command || '';

          // Default UX: immediately open the interactive shell so the user can see it,
          // rather than only showing the command preview.
          try {
            const newTab = root.querySelector('#docker-shell-newtab');
            shellState.openInNewTab = Boolean(newTab && newTab.checked);
            const detached = root.querySelector('#docker-shell-detached');
            shellState.openDetached = Boolean(detached && detached.checked);
          } catch (err) { }
          // Reuse the same logic as the "Open" button.
          try {
            if (shellState.openInNewTab) {
              const active = state.tabs && state.activeTabId ? state.tabs.get(state.activeTabId) : null;
              const host = active && active.host ? active.host : '';
              if (host) {
                window.dispatchEvent(new CustomEvent('marinashell:open-terminal-tab', {
                  detail: { host, command: shellState.command, detached: shellState.openDetached }
                }));
              }
              showToast(root, 'Shell opened in a new tab');
            } else {
              if (shellState.openDetached) {
                try { window.dispatchEvent(new CustomEvent('marinashell:detach-terminal')); } catch (err) { }
              }
              api.write(tabId, `${shellState.command}\n`);
              showToast(root, 'Shell started');
            }
            window.dispatchEvent(new CustomEvent('marinashell:focus-terminal'));
            closeShell(root);
          } catch (err) { }
        } catch (err) {
          if (cmdEl) cmdEl.textContent = '';
          if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = err && err.message ? err.message : 'Failed to prepare shell';
          }
        } finally {
          shellState.inFlight = false;
          renderLucide(root);
        }
      }

      function closeLogs(root) {
        logsState.open = false;
        if (logsState.timer) clearTimeout(logsState.timer);
        logsState.timer = null;
        logsState.inFlight = false;
        const modal = root.querySelector('#docker-logs-modal');
        if (modal) modal.classList.remove('open');
      }

      function closeShell(root) {
        shellState.open = false;
        shellState.inFlight = false;
        const modal = root.querySelector('#docker-shell-modal');
        if (modal) modal.classList.remove('open');
      }

      function scheduleLogs(root) {
        if (logsState.timer) clearTimeout(logsState.timer);
        logsState.timer = null;
        if (!logsState.open || !logsState.auto) return;
        logsState.timer = setTimeout(async () => {
          await refreshLogs(root);
          scheduleLogs(root);
        }, 1200);
      }

      async function refreshLogs(root) {
        if (!logsState.open || !logsState.containerId) return;
        if (logsState.inFlight) return;
        logsState.inFlight = true;
        const token = ++logsState.requestToken;
        const box = root.querySelector('#docker-logs-box');
        if (box) box.textContent = 'Loading...';
        const tabId = state.activeTabId;
        if (!tabId) {
          if (box) box.textContent = 'Not connected.';
          logsState.inFlight = false;
          return;
        }
        try {
          const res = await invoke('containerLogs', {
            tabId,
            id: logsState.containerId,
            options: { tail: logsState.tail, timestamps: true }
          });
          if (token !== logsState.requestToken) return;
          if (!logsState.open) return;
          if (!res || !res.ok) {
            if (box) box.textContent = (res && res.error) ? res.error : 'Failed to fetch logs.';
            return;
          }
          if (box) {
            box.textContent = res.text || '';
            box.parentElement && (box.parentElement.scrollTop = box.parentElement.scrollHeight);
          }
        } catch (err) {
          if (token !== logsState.requestToken) return;
          if (box) box.textContent = err && err.message ? err.message : 'Failed to fetch logs.';
        } finally {
          logsState.inFlight = false;
        }
      }

      async function loadView(root, opts = {}) {
        const tabId = state.activeTabId;
        const content = root.querySelector('#docker-content');
        if (!tabId) {
          content.innerHTML = renderEmpty('Not connected', 'Connect to a host via SSH to manage Docker resources.');
          return;
        }

        try {
          content.innerHTML = renderEmpty('Loading…', 'Fetching data from the remote host.');
          await ensureInit(tabId);
          setError(root, '');
          const useCache = Boolean(opts && opts.useCache);

          if (activeView === 'containers') {
            let data = useCache ? cache.containers : null;
            if (!data) {
              data = await fetchView(tabId, 'containers');
              cache.containers = data;
            }
            counts.containers = data.length;
            setBadges(root);
            const filtered = data.filter((r) => matchesSearch(`${r.Names || ''} ${r.Image || ''} ${r.ID || ''} ${r.Status || ''} ${r.Ports || ''}`, searchQuery));
            content.innerHTML = renderTable(filtered, [
              { label: 'ID', getHtml: (r) => `<span class="docker-mono">${escapeHtml((r.ID || '').slice(0, 12))}</span>` },
              {
                label: 'Name',
                getHtml: (r) => `
                  <div class="docker-cell">
                    <div class="docker-cell-title docker-mono docker-ellipsis" title="${escapeHtml(r.Names || '')}">${escapeHtml(r.Names || '')}</div>
                    <div class="docker-cell-sub docker-mono docker-ellipsis" title="${escapeHtml(r.Image || '')}">${escapeHtml(r.Image || '')}</div>
                  </div>
                `
              },
              {
                label: 'Status',
                getHtml: (r) => {
                  const s = formatStatus(r.State, r.Status);
                  return `<span class="docker-pill ${escapeHtml(s.tone)}"><span class="dot"></span>${escapeHtml(s.label)}</span>`;
                }
              },
              { label: 'Ports', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Ports || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => {
                  const id = escapeHtml(r.ID || '');
                  const stateLower = String(r.State || '').toLowerCase();
                  const canStart = stateLower !== 'running';
                  const canStop = stateLower === 'running';
                  const canExec = stateLower === 'running';
                  const name = escapeHtml(r.Names || '');
                  return `
                    <div class="docker-actions">
                      ${canStart ? `<button class="docker-action good" title="Start" data-kind="container" data-action="start" data-id="${id}" data-name="${name}"><i data-icon="play"></i></button>` : ''}
                      ${canStop ? `<button class="docker-action warn" title="Stop" data-kind="container" data-action="stop" data-id="${id}" data-name="${name}"><i data-icon="square"></i></button>` : ''}
                      <button class="docker-action info" title="Restart" data-kind="container" data-action="restart" data-id="${id}" data-name="${name}"><i data-icon="refresh-cw"></i></button>
                      <button class="docker-action purple" title="Logs" data-kind="container" data-action="logs" data-id="${id}" data-name="${name}"><i data-icon="file-text"></i></button>
                      ${canExec ? `<button class="docker-action cyan" title="Shell" data-kind="container" data-action="shell" data-id="${id}" data-name="${name}"><i data-icon="terminal"></i></button>` : ''}
                      <button class="docker-action danger" title="Delete" data-kind="container" data-action="remove" data-id="${id}" data-name="${name}"><i data-icon="trash-2"></i></button>
                    </div>
                  `;
                }
              }
            ]);
          } else if (activeView === 'images') {
            let data = useCache ? cache.images : null;
            if (!data) {
              data = await fetchView(tabId, 'images');
              cache.images = data;
            }
            counts.images = data.length;
            setBadges(root);
            const filtered = data.filter((r) => matchesSearch(`${r.Repository || ''}:${r.Tag || ''} ${r.ID || ''} ${r.Digest || ''} ${r.CreatedSince || ''} ${r.Size || ''}`, searchQuery));
            content.innerHTML = renderTable(filtered, [
              {
                label: 'Image',
                getHtml: (r) => {
                  const name = `${r.Repository || ''}:${r.Tag || ''}`;
                  const digestValue = r.Digest && r.Digest !== '<none>' ? String(r.Digest) : '';
                  const idValue = r.ID ? String(r.ID) : '';
                  const sub = digestValue ? `Digest: ${digestValue}` : (idValue ? `ID: ${idValue}` : '');
                  return `
                    <div class="docker-cell">
                      <div class="docker-cell-title docker-mono docker-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                      <div class="docker-cell-sub docker-mono docker-ellipsis" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div>
                    </div>
                  `;
                }
              },
              { label: 'Created', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.CreatedSince || '')}</span>` },
              { label: 'Size', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Size || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => {
                  const id = escapeHtml(r.ID || '');
                  return `<div class="docker-actions"><button class="docker-action danger" title="Delete image" data-kind="image" data-action="remove" data-id="${id}"><i data-icon="trash-2"></i></button></div>`;
                }
              }
            ]);
          } else if (activeView === 'volumes') {
            let data = useCache ? cache.volumes : null;
            if (!data) {
              data = await fetchView(tabId, 'volumes');
              cache.volumes = data;
            }
            counts.volumes = data.length;
            setBadges(root);
            const filtered = data.filter((r) => matchesSearch(`${r.Name || ''} ${r.Driver || ''}`, searchQuery));
            content.innerHTML = renderTable(filtered, [
              { label: 'Name', getHtml: (r) => `<span class="docker-mono docker-ellipsis" title="${escapeHtml(r.Name || '')}">${escapeHtml(r.Name || '')}</span>` },
              { label: 'Driver', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Driver || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => {
                  const name = escapeHtml(r.Name || '');
                  return `<div class="docker-actions"><button class="docker-action danger" title="Delete volume" data-kind="volume" data-action="remove" data-name="${name}"><i data-icon="trash-2"></i></button></div>`;
                }
              }
            ]);
          } else if (activeView === 'compose') {
            let data = useCache ? cache.compose : null;
            if (!data) {
              data = await fetchView(tabId, 'compose');
              cache.compose = data;
            }
            const rows = data.map((p) => ({
              Name: p.Name || p.name || '',
              Status: p.Status || p.status || '',
              ConfigFiles: p.ConfigFiles || p.configFiles || ''
            }));
            counts.compose = rows.length;
            setBadges(root);
            const filtered = rows.filter((r) => matchesSearch(`${r.Name} ${r.Status} ${r.ConfigFiles}`, searchQuery));
            content.innerHTML = renderTable(filtered, [
              { label: 'Project', getHtml: (r) => `<span class="docker-mono docker-ellipsis" title="${escapeHtml(r.Name)}">${escapeHtml(r.Name)}</span>` },
              { label: 'Status', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Status)}</span>` },
              { label: 'Config', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.ConfigFiles)}</span>` }
            ]);
          } else if (activeView === 'networks') {
            let data = useCache ? cache.networks : null;
            if (!data) {
              data = await fetchView(tabId, 'networks');
              cache.networks = data;
            }
            counts.networks = data.length;
            setBadges(root);
            const filtered = data.filter((r) => matchesSearch(`${r.Name || ''} ${r.ID || ''} ${r.Driver || ''} ${r.Scope || ''}`, searchQuery));
            content.innerHTML = renderTable(filtered, [
              { label: 'Name', getHtml: (r) => `<span class="docker-mono docker-ellipsis" title="${escapeHtml(r.Name || '')}">${escapeHtml(r.Name || '')}</span>` },
              { label: 'Driver', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Driver || '')}</span>` },
              { label: 'Scope', getHtml: (r) => `<span class="docker-muted">${escapeHtml(r.Scope || '')}</span>` },
              { label: 'ID', getHtml: (r) => `<span class="docker-mono docker-ellipsis" title="${escapeHtml(r.ID || '')}">${escapeHtml(r.ID || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => {
                  const id = escapeHtml(r.ID || r.Name || '');
                  return `<div class="docker-actions"><button class="docker-action danger" title="Delete network" data-kind="network" data-action="remove" data-id="${id}"><i data-icon="trash-2"></i></button></div>`;
                }
              }
            ]);
          }
          renderLucide(root);
        } catch (err) {
          setError(root, err && err.message ? err.message : 'Unexpected error');
          content.innerHTML = renderEmpty('Unable to load', 'Fix the error above and refresh.');
          renderLucide(root);
        }
      }

      async function refreshAll(root) {
        const tabId = state.activeTabId;
        const content = root.querySelector('#docker-content');
        if (!tabId) {
          await loadView(root);
          return;
        }
        try {
          setError(root, '');
          if (content) {
            content.innerHTML = renderEmpty('Refreshing…', 'Fetching containers, images, volumes, networks and compose.');
          }
          await ensureInit(tabId);
          const [containers, images, volumes, networks, compose] = await Promise.all([
            fetchView(tabId, 'containers'),
            fetchView(tabId, 'images'),
            fetchView(tabId, 'volumes'),
            fetchView(tabId, 'networks'),
            fetchView(tabId, 'compose')
          ]);
          cache = { containers, images, volumes, networks, compose };
          counts.containers = containers.length;
          counts.images = images.length;
          counts.volumes = volumes.length;
          counts.networks = networks.length;
          counts.compose = compose.length;
          setBadges(root);
          await loadView(root, { useCache: true });
        } catch (err) {
          setError(root, err && err.message ? err.message : 'Unable to refresh');
          if (content) {
            content.innerHTML = renderEmpty('Unable to refresh', 'Fix the error above and try again.');
          }
        }
      }

      async function handleAction(root, target) {
        const tabId = state.activeTabId;
        if (!tabId) return;

        const kind = target.getAttribute('data-kind');
        const action = target.getAttribute('data-action');

        try {
          if (kind === 'container') {
            const id = target.getAttribute('data-id');
            if (!id) return;
            const name = target.getAttribute('data-name') || '';
            const label = name ? `${name} (${id.slice(0, 12)})` : id.slice(0, 12);
            if (action === 'remove' && !confirm(`Delete container ${label}?`)) return;
            if (action === 'restart' && !confirm(`Restart container ${label}?`)) return;
            if (action === 'logs') {
              await openLogs(root, { id, name });
              return;
            }
            if (action === 'shell') {
              await openShell(root, { id, name });
              return;
            }
            const res = await invoke('containerAction', { tabId, action, id });
            if (!res.ok) throw new Error(res.error || 'Action failed');
          } else if (kind === 'image') {
            const id = target.getAttribute('data-id');
            if (!id) return;
            if (!confirm(`Delete image ${id}?`)) return;
            const res = await invoke('imageRemove', { tabId, id });
            if (!res.ok) throw new Error(res.error || 'Action failed');
          } else if (kind === 'volume') {
            const name = target.getAttribute('data-name');
            if (!name) return;
            if (!confirm(`Delete volume ${name}?`)) return;
            const res = await invoke('volumeRemove', { tabId, name });
            if (!res.ok) throw new Error(res.error || 'Action failed');
          } else if (kind === 'network') {
            const id = target.getAttribute('data-id');
            if (!id) return;
            if (!confirm(`Delete network ${id}?`)) return;
            const res = await invoke('networkRemove', { tabId, id });
            if (!res.ok) throw new Error(res.error || 'Action failed');
          }
          await loadView(root);
        } catch (err) {
          setError(root, err && err.message ? err.message : 'Action failed');
        }
      }

      function wireEvents(root) {
        if (options && typeof options.setRefresh === 'function') {
          options.setRefresh(() => refreshAll(root).catch(() => { }));
        } else {
          on(root, 'marinashell:refresh', () => refreshAll(root).catch(() => { }));
        }

        on(root, 'click', async (e) => {
          const target = e.target instanceof Element ? e.target : null;
          if (!target) return;

          const viewBtn = target.closest ? target.closest('button[data-view]') : null;
          if (viewBtn) {
            activeView = viewBtn.getAttribute('data-view');
            setActiveSegment(root);
            await loadView(root);
            return;
          }

          const actionBtn = target.closest ? target.closest('[data-action]') : null;
          const action = actionBtn ? actionBtn.getAttribute('data-action') : null;
          if (action === 'refresh') {
            await refreshAll(root);
            return;
          }
          if (action === 'logs-close') {
            closeLogs(root);
            return;
          }
          if (action === 'logs-refresh') {
            await refreshLogs(root);
            scheduleLogs(root);
            return;
          }
          if (action === 'shell-close') {
            closeShell(root);
            return;
          }
          if (action === 'shell-copy') {
            if (!shellState.command) return;
            try { api.copyToClipboard(shellState.command); } catch (err) { }
            showToast(root, 'Copied shell command');
            return;
          }
          if (action === 'shell-open') {
            if (!shellState.command) return;
            const tabIdNow = state.activeTabId;
            if (!tabIdNow) return;
            const newTab = root.querySelector('#docker-shell-newtab');
            const detached = root.querySelector('#docker-shell-detached');
            shellState.openInNewTab = Boolean(newTab && newTab.checked);
            shellState.openDetached = Boolean(detached && detached.checked);
            try { api.copyToClipboard(shellState.command); } catch (err) { }
          if (shellState.openInNewTab) {
            const active = state.tabs && state.activeTabId ? state.tabs.get(state.activeTabId) : null;
            const host = active && active.host ? active.host : '';
            try {
              window.dispatchEvent(new CustomEvent('marinashell:open-terminal-tab', {
                detail: { host, command: shellState.command, detached: shellState.openDetached }
              }));
            } catch (err) { }
            showToast(root, 'Opening shell in new tab (copied)');
          } else {
            if (shellState.openDetached) {
              try { window.dispatchEvent(new CustomEvent('marinashell:detach-terminal')); } catch (err) { }
            }
            api.write(tabIdNow, `${shellState.command}\n`);
            showToast(root, 'Shell started (copied)');
          }
          try { window.dispatchEvent(new CustomEvent('marinashell:focus-terminal')); } catch (err) { }
          closeShell(root);
          return;
        }

          const dockerAction = target.closest ? target.closest('button.docker-action') : null;
          if (dockerAction) {
            await handleAction(root, dockerAction);
          }
        });

        const input = root.querySelector('#docker-search');
        if (input) {
          on(input, 'input', () => {
            searchQuery = input.value || '';
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadView(root).catch(() => { }), 250);
          });
        }

        const tailInput = root.querySelector('#docker-logs-tail');
        if (tailInput) {
          on(tailInput, 'input', () => {
            logsState.tail = Math.max(10, Math.min(5000, Number(tailInput.value || 200)));
            refreshLogs(root).catch(() => { });
          });
        }
        const autoInput = root.querySelector('#docker-logs-auto');
        if (autoInput) {
          on(autoInput, 'change', () => {
            logsState.auto = Boolean(autoInput.checked);
            scheduleLogs(root);
          });
        }
        const modal = root.querySelector('#docker-logs-modal');
        if (modal) {
          on(modal, 'click', (ev) => {
            if (ev.target === modal) closeLogs(root);
          });
        }
        const shellModal = root.querySelector('#docker-shell-modal');
        if (shellModal) {
          on(shellModal, 'click', (ev) => {
            if (ev.target === shellModal) closeShell(root);
          });
        }
        const shellNewTab = root.querySelector('#docker-shell-newtab');
        if (shellNewTab) {
          on(shellNewTab, 'change', () => {
            shellState.openInNewTab = Boolean(shellNewTab.checked);
          });
        }
        const shellDetached = root.querySelector('#docker-shell-detached');
        if (shellDetached) {
          on(shellDetached, 'change', () => {
            shellState.openDetached = Boolean(shellDetached.checked);
          });
        }

        on(window, 'marinashell:active-tab-changed', () => {
          initialized = false;
          cache = { containers: null, images: null, volumes: null, networks: null, compose: null };
          counts = { containers: 0, images: 0, volumes: 0, networks: 0, compose: 0 };
          setBadges(root);
          if (logsState.open) closeLogs(root);
          if (shellState.open) closeShell(root);
          loadView(root).catch(() => { });
        });

        on(window, 'marinashell:session-state-changed', () => {
          initialized = false;
          cache = { containers: null, images: null, volumes: null, networks: null, compose: null };
          counts = { containers: 0, images: 0, volumes: 0, networks: 0, compose: 0 };
          setBadges(root);
          if (logsState.open) closeLogs(root);
          if (shellState.open) closeShell(root);
          loadView(root).catch(() => { });
        });
      }

      render(container);
      wireEvents(container);
      loadView(container).catch(() => { });

      return () => {
        try { abort.abort(); } catch (err) { }
        if (searchTimer) clearTimeout(searchTimer);
        if (toastTimer) clearTimeout(toastTimer);
        if (logsState.timer) clearTimeout(logsState.timer);
        container.style.overflow = prevOverflow;
        container.innerHTML = '';
      };
    }
  });
}
