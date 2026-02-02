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

function matchesSearch(haystack, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(haystack || '').toLowerCase().includes(q);
}

function injectStyles() {
  if (document.getElementById('mux-plugin-style')) return;
  const style = document.createElement('style');
  style.id = 'mux-plugin-style';
  style.textContent = `
    .mux-root {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      box-sizing: border-box;
      min-height: 0;
      color: rgba(255,255,255,0.92);
    }

	    .mux-bar {
	      display: flex;
	      align-items: center;
	      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(20, 26, 38, 0.55);
      backdrop-filter: blur(10px);
	      -webkit-backdrop-filter: blur(10px);
	      flex-wrap: wrap;
	    }
	
	    .mux-hint {
	      padding: 8px 12px;
	      border: 1px solid rgba(57,162,255,0.18);
	      background: rgba(57,162,255,0.06);
	      border-radius: 10px;
	      color: rgba(255,255,255,0.70);
	      font-size: 12px;
	      line-height: 1.4;
	    }
	    .mux-hint .mono {
	      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	      color: rgba(255,255,255,0.92);
	    }

	    .mux-seg {
	      display: inline-flex;
	      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(15, 19, 32, 0.65);
      border-radius: 10px;
      overflow: hidden;
    }
    .mux-seg button {
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.60);
      padding: 7px 10px;
      cursor: pointer;
      font-size: 12px;
      user-select: none;
      border-right: 1px solid rgba(255,255,255,0.08);
    }
    .mux-seg button:last-child { border-right: 0; }
    .mux-seg button:hover { color: rgba(255,255,255,0.90); background: rgba(255,255,255,0.04); }
    .mux-seg button.active { color: #fff; background: rgba(57,162,255,0.18); }

    .mux-right { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; justify-content: flex-end; flex-wrap: wrap; }
    .mux-search { position: relative; flex: 1 1 240px; max-width: 520px; min-width: 200px; }
    .mux-search input {
      width: 100%;
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.92);
      padding: 8px 10px 8px 28px;
      border-radius: 10px;
      font-size: 12px;
      outline: none;
    }
    .mux-search .icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: rgba(255,255,255,0.42);
      width: 14px;
      height: 14px;
      pointer-events: none;
    }

    .mux-btn {
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.72);
      height: 34px;
      padding: 0 10px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 12px;
      user-select: none;
    }
    .mux-btn:hover { border-color: rgba(255,255,255,0.14); color: rgba(255,255,255,0.92); }

    .mux-toggle {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: rgba(255,255,255,0.72);
      user-select: none;
      padding: 0 10px;
      height: 34px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(15, 19, 32, 0.65);
    }
    .mux-toggle input { width: auto; margin: 0; }

    .mux-content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(15, 19, 32, 0.90);
      border-radius: 12px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.22);
    }

    .mux-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .mux-table th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.58);
      position: sticky;
      top: 0;
      background: rgba(15, 19, 32, 0.98);
      z-index: 1;
    }
    .mux-table td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      vertical-align: middle;
      color: rgba(255,255,255,0.86);
    }
    .mux-table tr:hover td { background: rgba(255,255,255,0.03); }
    .mux-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .mux-muted { color: rgba(255,255,255,0.55); }

    .mux-actions { display: inline-flex; gap: 6px; align-items: center; }
    .mux-action {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
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
    .mux-action svg.lucide { width: 16px; height: 16px; }
    .mux-action:hover { border-color: rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }
    .mux-action.good { color: #a6e3a1; border-color: rgba(166,227,161,0.25); }
    .mux-action.good:hover { border-color: rgba(166,227,161,0.6); }
    .mux-action.danger { color: #f38ba8; border-color: rgba(243, 139, 168, 0.25); }
    .mux-action.danger:hover { border-color: rgba(243, 139, 168, 0.6); }

    .mux-error {
      padding: 10px 12px;
      border: 1px solid rgba(243, 139, 168, 0.25);
      background: rgba(243, 139, 168, 0.08);
      color: #f38ba8;
      border-radius: 10px;
      white-space: pre-wrap;
      display: none;
    }

    .mux-empty { padding: 22px 16px; color: rgba(255,255,255,0.58); }
    .mux-empty .h { color: rgba(255,255,255,0.86); font-weight: 650; margin-bottom: 6px; }
    .mux-empty .sub { max-width: 560px; line-height: 1.45; }

    .mux-modal {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(8, 12, 18, 0.7);
      z-index: 40;
      padding: 16px;
    }
    .mux-modal.open { display: flex; }
    .mux-modal-card {
      width: min(520px, 96%);
      background: rgba(15, 19, 32, 0.96);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 12px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.45);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .mux-modal-title { font-size: 13px; font-weight: 650; color: rgba(255,255,255,0.92); }
    .mux-modal-sub { font-size: 12px; color: rgba(255,255,255,0.60); }
    .mux-modal-card input {
      width: 100%;
      background: rgba(15, 19, 32, 0.65);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.92);
      padding: 9px 10px;
      border-radius: 10px;
      font-size: 12px;
      outline: none;
    }
    .mux-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  `;
  document.head.appendChild(style);
}

function renderEmpty(title, subtitle) {
  return `
    <div class="mux-empty">
      <div class="h">${escapeHtml(title || 'Nothing to show')}</div>
      <div class="sub">${escapeHtml(subtitle || '')}</div>
    </div>
  `;
}

function renderTable(rows, columns) {
  if (!rows || !rows.length) return renderEmpty('No sessions', 'Create one, or refresh.');
  const headers = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((c) => `<td>${c.getHtml(row)}</td>`).join('')}</tr>`).join('');
  return `<table class="mux-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

export default function (context) {
  const { registerView, registerTab, registerTerminalAction, api, state } = context;
  const register = typeof registerView === 'function'
    ? registerView
    : (id, info) => {
      if (typeof registerTab !== 'function') return;
      registerTab(id, info.title || id, (panel) => info.mount(panel));
    };

  function shellSingleQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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

  function ensureTerminalChooserStyles() {
    if (document.getElementById('mux-terminal-chooser-style')) return;
    const style = document.createElement('style');
    style.id = 'mux-terminal-chooser-style';
    style.textContent = `
      .mux-menu {
        position: fixed;
        z-index: 9999;
        min-width: 320px;
        max-width: min(520px, calc(100vw - 24px));
        padding: 8px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(15, 19, 32, 0.96);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 18px 55px rgba(0,0,0,0.55);
        color: rgba(255,255,255,0.90);
        font-size: 12px;
        user-select: none;
      }
      .mux-menu .hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px 6px;
      }
      .mux-menu .title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 650;
      }
      .mux-menu .mini {
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .mux-menu .mini label {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        color: rgba(255,255,255,0.65);
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.03);
        padding: 6px 8px;
        border-radius: 10px;
        cursor: pointer;
      }
      .mux-menu .mini .mux-mini-action {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        color: rgba(255,255,255,0.85);
        cursor: pointer;
        user-select: none;
      }
      .mux-menu .mini .mux-mini-action:hover {
        border-color: rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.06);
      }
      .mux-menu .mini .mux-mini-action.danger {
        color: #f38ba8;
        border-color: rgba(243,139,168,0.25);
      }
      .mux-menu .mini .mux-mini-action.danger:hover {
        border-color: rgba(243,139,168,0.55);
      }
      .mux-menu .mini input { width: auto; margin: 0; }
      .mux-menu .divider {
        height: 1px;
        background: rgba(255,255,255,0.08);
        margin: 6px 0;
      }
      .mux-menu .list {
        max-height: min(420px, calc(100vh - 160px));
        overflow: auto;
        padding: 2px;
      }
      .mux-menu .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 10px;
        cursor: pointer;
      }
      .mux-menu .row.editing { cursor: default; }
      .mux-menu .row:hover { background: rgba(255,255,255,0.06); }
      .mux-menu .row:active { background: rgba(255,255,255,0.10); }
      .mux-menu .row.disabled { opacity: 0.55; cursor: default; pointer-events: none; }
      .mux-menu .name { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color: rgba(255,255,255,0.92); }
      .mux-menu .sub { color: rgba(255,255,255,0.55); font-size: 11px; margin-left: auto; white-space: nowrap; }
      .mux-menu .rename-input {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        color: rgba(255,255,255,0.92);
        background: rgba(0,0,0,0.20);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        padding: 6px 8px;
        outline: none;
        min-width: 180px;
      }
      .mux-menu .rename-hint {
        margin-left: auto;
        color: rgba(255,255,255,0.50);
        font-size: 11px;
        white-space: nowrap;
      }
      .mux-menu .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        color: rgba(255,255,255,0.70);
        font-size: 11px;
      }
      .mux-menu .pill.good { border-color: rgba(166,227,161,0.25); color: #a6e3a1; }
      .mux-menu .iconbtn {
        width: 28px;
        height: 28px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        color: rgba(255,255,255,0.78);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        user-select: none;
      }
      .mux-menu .iconbtn:hover { border-color: rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); }
      .mux-menu .iconbtn.danger { color: #f38ba8; border-color: rgba(243,139,168,0.25); }
      .mux-menu .iconbtn.danger:hover { border-color: rgba(243,139,168,0.55); }
      .mux-menu .empty {
        padding: 12px 10px;
        color: rgba(255,255,255,0.60);
      }
    `;
    document.head.appendChild(style);
  }

  // Terminal header action: tmux session chooser (like screenshot plugin).
  if (typeof registerTerminalAction === 'function') {
    ensureTerminalChooserStyles();

    const tmuxAttachedByTabId = new Map(); // tabId -> boolean
    let menuEl = null;
    let inFlight = false;
    let detached = true;
    let forceDetachOthers = false;
    let lastAnchorEl = null;

    function closeMenu() {
      if (!menuEl) return;
      try { menuEl.remove(); } catch (err) { }
      menuEl = null;
      lastAnchorEl = null;
    }

    function positionMenu(anchorEl) {
      if (!menuEl || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const margin = 8;
      const preferredTop = rect.bottom + margin;
      const preferredLeft = rect.right - menuEl.offsetWidth;
      const maxLeft = window.innerWidth - menuEl.offsetWidth - margin;
      const minLeft = margin;
      const left = Math.max(minLeft, Math.min(maxLeft, preferredLeft));
      const maxTop = window.innerHeight - menuEl.offsetHeight - margin;
      const top = Math.max(margin, Math.min(maxTop, preferredTop));
      menuEl.style.left = `${Math.round(left)}px`;
      menuEl.style.top = `${Math.round(top)}px`;
    }

    async function invoke(channel, payload) {
      return api.invoke(`plugin:tmux:${channel}`, payload);
    }

    function getActiveTabId() {
      return state && state.activeTabId ? state.activeTabId : null;
    }

    async function attachSession(name) {
      const tabId = getActiveTabId();
      if (!tabId || !name) return;
      const cmd = `tmux attach ${forceDetachOthers ? '-d ' : ''}-t ${shellSingleQuote(name)}`;
      if (detached) {
        try { window.dispatchEvent(new CustomEvent('marinashell:detach-terminal')); } catch (err) { }
      }
      try { window.dispatchEvent(new CustomEvent('marinashell:focus-terminal')); } catch (err) { }
      try { api.write(tabId, `${cmd}\n`); } catch (err) { }
      tmuxAttachedByTabId.set(tabId, true);
      closeMenu();
    }

	    async function createAndAttach() {
	      const tabId = getActiveTabId();
	      if (!tabId) return;
	      const res = await invoke('createTmux', { tabId, name: '' });
      if (!res || !res.ok) {
        throw new Error(res && res.error ? res.error : 'Failed to create tmux session');
      }
      const created = res && res.name ? String(res.name) : '';
	      if (created) {
	        await attachSession(created);
	      }
	    }

	    async function renameSession(oldName, newName) {
	      const tabId = getActiveTabId();
	      if (!tabId) return;
	      const res = await invoke('renameTmux', { tabId, oldName, newName });
	      if (!res || !res.ok) {
	        throw new Error(res && res.error ? res.error : 'Rename failed');
	      }
	    }

    async function detachClient() {
      const tabId = getActiveTabId();
      if (!tabId) return;
      try { api.write(tabId, `tmux detach-client\n`); } catch (err) { }
      tmuxAttachedByTabId.set(tabId, false);
      closeMenu();
    }

    async function killSession(name) {
      const tabId = getActiveTabId();
      if (!tabId || !name) return;
      if (!confirm(`Kill tmux session "${name}"?`)) return;
      const res = await invoke('killTmux', { tabId, name });
      if (!res || !res.ok) {
        throw new Error(res && res.error ? res.error : 'Kill failed');
      }
    }

    async function openMenu(anchorEl) {
      if (menuEl) {
        closeMenu();
        return;
      }
      lastAnchorEl = anchorEl;
      menuEl = document.createElement('div');
      menuEl.className = 'mux-menu';
      const tabId = getActiveTabId();
      const isAttached = Boolean(tabId && tmuxAttachedByTabId.get(tabId));
      menuEl.innerHTML = `
        <div class="hdr">
          <div class="title"><i data-icon="panels-top-left"></i><span>tmux</span></div>
          <div class="mini">
            ${isAttached
              ? `<button class="mux-mini-action danger" data-action="detach" title="Detach from tmux"><i data-icon="log-out"></i><span>Detach</span></button>`
              : `
                <label title="Open terminal in split pane"><input type="checkbox" data-opt="detached" ${detached ? 'checked' : ''} /><span>Detached</span></label>
                <label title="Detach other clients when attaching"><input type="checkbox" data-opt="forcedetach" ${forceDetachOthers ? 'checked' : ''} /><span>Force</span></label>
                <button class="iconbtn" data-action="new" title="New tmux session"><i data-icon="plus"></i></button>
                <button class="iconbtn" data-action="refresh" title="Refresh"><i data-icon="refresh-cw"></i></button>
              `}
            <button class="iconbtn" data-action="close" title="Close"><i data-icon="x"></i></button>
          </div>
        </div>
        <div class="divider"></div>
        ${isAttached
          ? `<div class="empty">Attached to tmux. Detach to switch sessions.</div>`
          : `<div class="list" data-list><div class="empty">Loading…</div></div>`}
      `;
      document.body.appendChild(menuEl);
      renderLucide(menuEl);
      positionMenu(anchorEl);

	      if (!tabId) {
	        const list = menuEl.querySelector('[data-list]');
	        if (list) list.innerHTML = `<div class="empty">No active session.</div>`;
	        return;
	      }

	      async function refreshList() {
	        if (isAttached) return;
	        if (inFlight) return;
	        inFlight = true;
	        const list = menuEl.querySelector('[data-list]');
	        if (list) list.innerHTML = `<div class="empty">Loading…</div>`;
        try {
          const res = await invoke('listTmux', { tabId });
          if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'Failed to list tmux sessions');
          const rows = res.data || [];
          if (!rows.length) {
            if (list) list.innerHTML = `<div class="empty">No tmux sessions found.</div>`;
            return;
          }
		          if (list) {
		            list.innerHTML = rows.map((s) => {
		              const name = String(s.name || '');
		              const encoded = encodeURIComponent(name);
		              const windows = Number(s.windows || 0);
		              const attachedState = Boolean(s.attached);
		              const activity = String(s.activity || '').trim();
		              const pill = attachedState ? `<span class="pill good">Attached</span>` : `<span class="pill">Detached</span>`;
		              const sub = `${windows} win${windows === 1 ? '' : 's'}${activity ? ` · ${activity}` : ''}`;
		              return `
		                <div class="row" data-action="attach" data-name="${encoded}">
		                  <span class="name">${escapeHtml(name)}</span>
		                  ${pill}
		                  <span class="sub">${escapeHtml(sub)}</span>
		                  <button class="iconbtn" data-action="rename" data-name="${encoded}" title="Rename"><i data-icon="pencil"></i></button>
		                  <button class="iconbtn danger" data-action="kill" data-name="${encoded}" title="Kill"><i data-icon="trash-2"></i></button>
		                </div>
		              `;
		            }).join('');
		          }
          renderLucide(menuEl);
        } catch (err) {
          if (list) list.innerHTML = `<div class="empty" style="color:#f38ba8;">${String(err && err.message ? err.message : 'Failed to load')}</div>`;
        } finally {
          inFlight = false;
          positionMenu(lastAnchorEl);
        }
	      }

	      if (!isAttached) {
	        await refreshList();
	      }

	      function beginInlineRename(encoded) {
	        if (!menuEl) return;
	        const row = menuEl.querySelector(`.row[data-name="${encoded}"]`);
	        if (!row) return;
	        if (row.classList.contains('editing')) return;
	        row.classList.add('editing');
	        const nameSpan = row.querySelector('.name');
	        const original = nameSpan ? nameSpan.textContent || '' : '';
	        if (nameSpan) {
	          nameSpan.outerHTML = `<input class="rename-input" data-rename-input value="${escapeHtml(original)}" />`;
	        } else {
	          row.insertAdjacentHTML('afterbegin', `<input class="rename-input" data-rename-input value="${escapeHtml(original)}" />`);
	        }
	        // Hide other controls while editing to avoid mis-clicks
	        row.querySelectorAll('button.iconbtn, span.pill, span.sub').forEach((el) => {
	          el.style.display = 'none';
	        });
	        row.insertAdjacentHTML('beforeend', `<span class="rename-hint">Enter to save · Esc to cancel</span>`);
	        const input = row.querySelector('[data-rename-input]');
	        if (!input) return;
	        setTimeout(() => {
	          try { input.focus(); input.select(); } catch (err) { }
	        }, 0);
	        const finish = async (mode) => {
	          const next = String(input.value || '').trim();
	          const oldName = original;
	          row.classList.remove('editing');
	          if (mode === 'save' && next && next !== oldName) {
	            try {
	              await renameSession(oldName, next);
	            } catch (err) {
	              // show error in list area
	              const list = menuEl ? menuEl.querySelector('[data-list]') : null;
	              if (list) {
	                list.insertAdjacentHTML('afterbegin', `<div class="empty" style="color:#f38ba8;">${escapeHtml(err && err.message ? err.message : 'Rename failed')}</div>`);
	              }
	            }
	          }
	          await refreshList();
	        };
	        input.addEventListener('click', (ev) => ev.stopPropagation());
	        input.addEventListener('keydown', (ev) => {
	          if (ev.key === 'Escape') {
	            ev.preventDefault();
	            ev.stopPropagation();
	            finish('cancel');
	          }
	          if (ev.key === 'Enter') {
	            ev.preventDefault();
	            ev.stopPropagation();
	            finish('save');
	          }
	        });
	        input.addEventListener('blur', () => {
	          finish('save');
	        });
	      }

	      menuEl.addEventListener('click', async (e) => {
	        const rawTarget = e.target;
	        if (rawTarget && rawTarget.closest && rawTarget.closest('[data-rename-input]')) {
	          return;
	        }
	        const target = e.target && e.target.closest ? e.target.closest('[data-action],button') : null;
	        if (!target) return;
	        const action = target.getAttribute('data-action');
	        if (action === 'close') {
	          closeMenu();
	          return;
	        }
        if (action === 'detach') {
          await detachClient();
          return;
        }
	        if (action === 'refresh') {
	          await refreshList();
	          return;
	        }
	        if (action === 'rename') {
	          const raw = target.getAttribute('data-name') || '';
	          beginInlineRename(raw);
	          return;
	        }
		        if (action === 'new') {
		          const list = menuEl ? menuEl.querySelector('[data-list]') : null;
		          if (list) list.innerHTML = `<div class="empty">Creating…</div>`;
	          try {
	            await createAndAttach();
	          } catch (err) {
	            if (list) list.innerHTML = `<div class="empty" style="color:#f38ba8;">${escapeHtml(err && err.message ? err.message : 'Failed to create')}</div>`;
	          }
	          return;
	        }
		        if (action === 'attach') {
		          const raw = target.getAttribute('data-name') || '';
		          let name = raw;
		          try { name = decodeURIComponent(raw); } catch (err) { }
	          await attachSession(name);
	          return;
	        }
	        if (action === 'kill') {
	          const raw = target.getAttribute('data-name') || '';
	          let name = raw;
	          try { name = decodeURIComponent(raw); } catch (err) { }
	          try {
	            await killSession(name);
	            await refreshList();
	          } catch (err) {
            // leave menu open so user can retry
          }
        }
      });

      menuEl.addEventListener('change', (e) => {
        const input = e.target && e.target.closest ? e.target.closest('input[data-opt]') : null;
        if (!input) return;
        const opt = input.getAttribute('data-opt');
        if (opt === 'detached') detached = Boolean(input.checked);
        if (opt === 'forcedetach') forceDetachOthers = Boolean(input.checked);
      });
    }

    window.addEventListener('marinashell:ssh-prompt', (e) => {
      const payload = e && e.detail ? e.detail : null;
      const tabId = payload && payload.tabId ? String(payload.tabId) : null;
      if (!tabId) return;
      tmuxAttachedByTabId.set(tabId, false);
    });
    window.addEventListener('marinashell:ssh-exit', (e) => {
      const payload = e && e.detail ? e.detail : null;
      const tabId = payload && payload.tabId ? String(payload.tabId) : null;
      if (!tabId) return;
      tmuxAttachedByTabId.delete(tabId);
    });

    window.addEventListener('pointerdown', (e) => {
      if (!menuEl) return;
      const target = e.target;
      if (target && target.closest && target.closest('.mux-menu')) return;
      if (lastAnchorEl && lastAnchorEl.contains && lastAnchorEl.contains(target)) return;
      closeMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (!menuEl) return;
      if (e.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', () => {
      if (!menuEl || !lastAnchorEl) return;
      positionMenu(lastAnchorEl);
    });

    registerTerminalAction('tmux', {
      title: 'tmux',
      icon: 'panels-top-left',
      onClick: ({ anchorEl }) => {
        openMenu(anchorEl);
      }
    });
  }

  if (false) register('tmux', {
    title: 'Tmux',
    iconClass: 'icon-terminal',
    supports: ['ssh', 'local'],
    mount: (container, options = {}) => {
      injectStyles();
      const abort = new AbortController();
      const on = (el, event, handler) => el.addEventListener(event, handler, { signal: abort.signal });

      let view = 'tmux'; // tmux | screen
      let search = '';
      let tmuxInstalled = null;
      let screenInstalled = null;
      let nameModalOpen = false;
      let attachDetached = true;
      let attachNewTab = false;
      let attachAfterCreate = true;

      async function invoke(channel, payload) {
        return api.invoke(`plugin:tmux:${channel}`, payload);
      }

      function setError(message) {
        const el = container.querySelector('#mux-error');
        if (!el) return;
        if (!message) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        el.style.display = 'block';
        el.textContent = message;
      }

      function setActive() {
        container.querySelectorAll('button[data-view]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-view') === view);
        });
      }

      function render() {
        container.innerHTML = `
          <div class="mux-root">
	            <div class="mux-bar">
              <div class="mux-seg" role="tablist" aria-label="Multiplexer">
                <button data-view="tmux" role="tab">tmux</button>
                <button data-view="screen" role="tab">screen</button>
              </div>
              <div class="mux-right">
                <div class="mux-search">
                  <i class="icon" data-icon="search"></i>
                  <input id="mux-search" type="text" placeholder="Search…" value="${escapeHtml(search)}" />
                </div>
                <label class="mux-toggle" title="Keep list visible by opening the terminal in a split pane">
                  <input id="mux-detached" type="checkbox" ${attachDetached ? 'checked' : ''} />
                  <span>Detached</span>
                </label>
                <label class="mux-toggle" title="Open attach in a new SSH tab">
                  <input id="mux-newtab" type="checkbox" ${attachNewTab ? 'checked' : ''} />
                  <span>New tab</span>
                </label>
                <button class="mux-btn" data-action="new">New</button>
                <button class="mux-btn" data-action="refresh">Refresh</button>
              </div>
	            </div>
	            ${view === 'tmux' ? `<div class="mux-hint">Attach in the terminal: click <span class="mono">tmux</span> in the Terminal header (top-right) and pick a session.</div>` : ''}
	            <div class="mux-error" id="mux-error"></div>
	            <div class="mux-content" id="mux-content">${renderEmpty('Loading…', 'Checking remote host.')}</div>

            <div class="mux-modal" id="mux-modal">
              <div class="mux-modal-card" role="dialog" aria-modal="true">
                <div class="mux-modal-title">New session</div>
                <div class="mux-modal-sub" id="mux-modal-sub"></div>
                <input id="mux-modal-name" type="text" placeholder="Optional name" />
                <label class="mux-toggle" style="width: fit-content;" title="Immediately attach after creating the session">
                  <input id="mux-modal-attach" type="checkbox" ${attachAfterCreate ? 'checked' : ''} />
                  <span>View after create</span>
                </label>
                <div class="mux-modal-actions">
                  <button class="mux-btn" data-action="modal-cancel">Cancel</button>
                  <button class="mux-btn" data-action="modal-create">Create</button>
                </div>
              </div>
            </div>
          </div>
        `;
        setActive();
        renderLucide(container);
      }

      async function ensureStatus() {
        const tabId = state.activeTabId;
        if (!tabId) throw new Error('No active session');
        const res = await invoke('status', { tabId });
        if (!res.ok) throw new Error(res.error || 'Failed to detect tmux/screen');
        tmuxInstalled = Boolean(res.tmux);
        screenInstalled = Boolean(res.screen);
      }

      async function load() {
        const tabId = state.activeTabId;
        const content = container.querySelector('#mux-content');
        if (!content) return;
        if (!tabId) {
          content.innerHTML = renderEmpty('Not connected', 'Connect to a host via SSH to manage tmux/screen.');
          return;
        }
        try {
          setError('');
          content.innerHTML = renderEmpty('Loading…', 'Fetching sessions.');
          await ensureStatus();

          if (view === 'tmux' && !tmuxInstalled) {
            content.innerHTML = renderEmpty('tmux not installed', 'Install it on the remote host (e.g. apt install tmux) and refresh.');
            return;
          }
          if (view === 'screen' && !screenInstalled) {
            content.innerHTML = renderEmpty('screen not installed', 'Install it on the remote host (e.g. apt install screen) and refresh.');
            return;
          }

          if (view === 'tmux') {
            const res = await invoke('listTmux', { tabId });
            if (!res.ok) throw new Error(res.error || 'Failed to list tmux sessions');
            const filtered = (res.data || []).filter((s) => matchesSearch(`${s.name} ${s.windows} ${s.attached}`, search));
            content.innerHTML = renderTable(filtered, [
              { label: 'Session', getHtml: (r) => `<span class="mux-mono">${escapeHtml(r.name)}</span>` },
              { label: 'Windows', getHtml: (r) => `<span class="mux-muted">${escapeHtml(String(r.windows || 0))}</span>` },
              { label: 'State', getHtml: (r) => r.attached ? '<span class="mux-muted" style="color:#a6e3a1;">Attached</span>' : '<span class="mux-muted">Detached</span>' },
              { label: 'Last Activity', getHtml: (r) => `<span class="mux-muted">${escapeHtml(r.activity || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => `
                  <div class="mux-actions">
                    <button class="mux-action danger" title="Kill" data-kind="tmux" data-action="kill" data-name="${escapeHtml(r.name)}"><i data-icon="trash-2"></i></button>
                  </div>
                `
              }
            ]);
          } else {
            const res = await invoke('listScreen', { tabId });
            if (!res.ok) throw new Error(res.error || 'Failed to list screen sessions');
            const filtered = (res.data || []).filter((s) => matchesSearch(`${s.id} ${s.name} ${s.status}`, search));
            content.innerHTML = renderTable(filtered, [
              { label: 'Session', getHtml: (r) => `<span class="mux-mono">${escapeHtml(r.name)}</span><div class="mux-muted mux-mono">${escapeHtml(r.id)}</div>` },
              { label: 'State', getHtml: (r) => `<span class="mux-muted">${escapeHtml(r.status || '')}</span>` },
              {
                label: 'Actions',
                getHtml: (r) => `
                  <div class="mux-actions">
                    <button class="mux-action danger" title="Kill" data-kind="screen" data-action="kill" data-id="${escapeHtml(r.id)}"><i data-icon="trash-2"></i></button>
                  </div>
                `
              }
            ]);
          }
          renderLucide(container);
        } catch (err) {
          setError(err && err.message ? err.message : 'Unexpected error');
          content.innerHTML = renderEmpty('Unable to load', 'Fix the error above and refresh.');
          renderLucide(container);
        }
      }

      async function startAttach(command) {
        const tabId = state.activeTabId;
        if (!tabId) return;
        try {
          await api.copyToClipboard(command);
        } catch (err) { }
        const active = state.tabs && state.activeTabId ? state.tabs.get(state.activeTabId) : null;
        const host = active && active.host ? String(active.host) : '';

        if (attachNewTab && host) {
          try {
            window.dispatchEvent(new CustomEvent('marinashell:open-terminal-tab', {
              detail: { host, command, detached: attachDetached }
            }));
          } catch (err) { }
          return;
        }

        if (attachDetached) {
          try { window.dispatchEvent(new CustomEvent('marinashell:detach-terminal')); } catch (err) { }
        }
        api.write(tabId, `${command}\n`);
        try { window.dispatchEvent(new CustomEvent('marinashell:focus-terminal')); } catch (err) { }
      }

      async function createSession() {
        // Electron doesn't support window.prompt(). Use an in-plugin modal instead.
        const modal = container.querySelector('#mux-modal');
        const sub = container.querySelector('#mux-modal-sub');
        const input = container.querySelector('#mux-modal-name');
        if (sub) sub.textContent = view === 'tmux' ? 'Creates a detached tmux session.' : 'Creates a detached GNU screen session.';
        if (input) input.value = '';
        if (modal) modal.classList.add('open');
        nameModalOpen = true;
        if (input) {
          setTimeout(() => {
            try { input.focus(); } catch (err) { }
          }, 0);
        }
      }

      async function submitCreateSession() {
        const tabId = state.activeTabId;
        if (!tabId) return;
        const input = container.querySelector('#mux-modal-name');
        const modal = container.querySelector('#mux-modal');
        const attachToggle = container.querySelector('#mux-modal-attach');
        attachAfterCreate = Boolean(attachToggle && attachToggle.checked);
        const name = input ? (input.value || '') : '';
        if (view === 'tmux') {
          const res = await invoke('createTmux', { tabId, name });
          if (!res.ok) throw new Error(res.error || 'Failed to create tmux session');
          if (attachAfterCreate && res.name) {
            const attachRes = await invoke('attachTmux', { tabId, name: res.name });
            if (attachRes && attachRes.ok && attachRes.command) {
              await startAttach(attachRes.command);
            }
          }
        } else {
          const res = await invoke('createScreen', { tabId, name });
          if (!res.ok) throw new Error(res.error || 'Failed to create screen session');
        }
        if (modal) modal.classList.remove('open');
        nameModalOpen = false;
        await load();
      }

      function closeModal() {
        const modal = container.querySelector('#mux-modal');
        if (modal) modal.classList.remove('open');
        nameModalOpen = false;
      }

      async function handleAction(target) {
        const tabId = state.activeTabId;
        if (!tabId) return;
        const kind = target.getAttribute('data-kind');
        const action = target.getAttribute('data-action');

        if (kind === 'tmux') {
          const name = target.getAttribute('data-name');
          if (!name) return;
          if (action === 'attach') {
            const res = await invoke('attachTmux', { tabId, name });
            if (!res.ok) throw new Error(res.error || 'Attach failed');
            await startAttach(res.command);
            return;
          }
          if (action === 'kill') {
            if (!confirm(`Kill tmux session "${name}"?`)) return;
            const res = await invoke('killTmux', { tabId, name });
            if (!res.ok) throw new Error(res.error || 'Kill failed');
            await load();
            return;
          }
        }

        if (kind === 'screen') {
          const id = target.getAttribute('data-id');
          if (!id) return;
          if (action === 'attach') {
            const status = (target.getAttribute('data-status') || '').toLowerCase();
            const mode = status === 'attached' ? 'multi' : 'single';
            const res = await invoke('attachScreen', { tabId, id, mode });
            if (!res.ok) throw new Error(res.error || 'Attach failed');
            await startAttach(res.command);
            return;
          }
          if (action === 'kill') {
            if (!confirm(`Kill screen session "${id}"?`)) return;
            const res = await invoke('killScreen', { tabId, id });
            if (!res.ok) throw new Error(res.error || 'Kill failed');
            await load();
            return;
          }
        }
      }

      render();

      if (options && typeof options.setRefresh === 'function') {
        options.setRefresh(() => load().catch(() => { }));
      } else {
        // Fallback for older containers: allow dock header to trigger refresh.
        on(container, 'marinashell:refresh', () => load().catch(() => { }));
      }

      on(container, 'click', async (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const viewBtn = target.closest ? target.closest('button[data-view]') : null;
        if (viewBtn) {
          view = viewBtn.getAttribute('data-view');
          setActive();
          await load();
          return;
        }

        const actionBtn = target.closest ? target.closest('[data-action]') : null;
        const action = actionBtn ? actionBtn.getAttribute('data-action') : null;
        if (action === 'refresh') {
          await load();
          return;
        }
        if (action === 'new') {
          await createSession();
          return;
        }
        if (action === 'modal-cancel') {
          closeModal();
          return;
        }
        if (action === 'modal-create') {
          try {
            await submitCreateSession();
          } catch (err) {
            setError(err && err.message ? err.message : 'Failed to create session');
          }
          return;
        }

        const actionEl = target.closest ? target.closest('button.mux-action') : null;
        if (actionEl) {
          await handleAction(actionEl);
        }
      });

      const input = container.querySelector('#mux-search');
      if (input) {
        let t = null;
        on(input, 'input', () => {
          search = input.value || '';
          if (t) clearTimeout(t);
          t = setTimeout(() => load().catch(() => { }), 200);
        });
      }

      const detachedToggle = container.querySelector('#mux-detached');
      if (detachedToggle) {
        on(detachedToggle, 'change', () => {
          attachDetached = Boolean(detachedToggle.checked);
        });
      }

      const newTabToggle = container.querySelector('#mux-newtab');
      if (newTabToggle) {
        on(newTabToggle, 'change', () => {
          attachNewTab = Boolean(newTabToggle.checked);
        });
      }

      const modalInput = container.querySelector('#mux-modal-name');
      if (modalInput) {
        on(modalInput, 'keydown', async (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            closeModal();
            return;
          }
          if (ev.key === 'Enter') {
            ev.preventDefault();
            try {
              await submitCreateSession();
            } catch (err) {
              setError(err && err.message ? err.message : 'Failed to create session');
            }
          }
        });
      }

      const modal = container.querySelector('#mux-modal');
      if (modal) {
        on(modal, 'click', (ev) => {
          if (ev.target === modal) closeModal();
        });
      }

      on(window, 'marinashell:active-tab-changed', () => {
        if (nameModalOpen) closeModal();
        load().catch(() => { });
      });

      on(window, 'marinashell:session-state-changed', () => {
        if (nameModalOpen) closeModal();
        load().catch(() => { });
      });

      load().catch(() => { });

      return () => {
        try { abort.abort(); } catch (err) { }
        container.innerHTML = '';
      };
    }
  });
}
