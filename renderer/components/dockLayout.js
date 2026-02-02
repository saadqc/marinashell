import { getActiveTab } from '../state.js';

export function createDockLayout({ rootEl, toolbarEl, sessionTabs, terminalStackEl, state }) {
  const views = new Map(); // id -> { id, title, iconClass, mount, supports, requiresConnection }
  const terminalActions = new Map(); // id -> { id, title, icon, onClick }

  let activeLeafId = null;
  let leafCounter = 0;
  const leaves = new Map(); // leafId -> { el, headerEl, bodyEl, viewId, cleanup }

  const toolbarViewsEl = toolbarEl ? document.createElement('div') : null;
  const toolbarActionsEl = toolbarEl ? document.createElement('div') : null;
  if (toolbarEl) {
    toolbarEl.innerHTML = '';
    toolbarViewsEl.style.display = 'flex';
    toolbarViewsEl.style.gap = '6px';
    toolbarViewsEl.style.alignItems = 'center';
    toolbarActionsEl.style.display = 'flex';
    toolbarActionsEl.style.gap = '6px';
    toolbarActionsEl.style.alignItems = 'center';
    toolbarEl.appendChild(toolbarViewsEl);
    toolbarEl.appendChild(toolbarActionsEl);
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

  function createEl(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function setLeafActive(leafId) {
    activeLeafId = leafId;
    for (const [id, leaf] of leaves.entries()) {
      leaf.el.classList.toggle('active', id === leafId);
    }
    syncToolbarActiveState();
  }

  function ensureLeafSelected() {
    if (activeLeafId && leaves.has(activeLeafId)) return activeLeafId;
    const first = leaves.keys().next().value || null;
    if (first) setLeafActive(first);
    return first;
  }

  function buildLeaf() {
    const id = `leaf-${++leafCounter}`;
    const leafEl = createEl('div', 'dock-leaf');
    leafEl.dataset.leafId = id;

    const headerEl = createEl('div', 'dock-leaf-header');
    const titleEl = createEl('div', 'dock-leaf-title');
    const iconEl = createEl('span', 'dock-icon icon-terminal');
    const nameEl = createEl('span', 'name');
    nameEl.textContent = 'Empty';
    titleEl.appendChild(iconEl);
    titleEl.appendChild(nameEl);

    const actionsEl = createEl('div', 'dock-leaf-actions');
    const extraActionsEl = createEl('div', 'dock-leaf-actions-extra');
    extraActionsEl.style.display = 'inline-flex';
    extraActionsEl.style.alignItems = 'center';
    extraActionsEl.style.gap = '6px';
    const refreshBtn = createEl('button', 'dock-mini-btn');
    refreshBtn.title = 'Refresh';
    refreshBtn.innerHTML = '<i data-icon="refresh-cw"></i>';
    refreshBtn.dataset.action = 'refresh';
    refreshBtn.disabled = true;

    const splitVBtn = createEl('button', 'dock-mini-btn');
    splitVBtn.title = 'Split Right';
    splitVBtn.innerHTML = '<i data-icon="columns-2"></i>';
    splitVBtn.dataset.action = 'split-vertical';

    const splitHBtn = createEl('button', 'dock-mini-btn');
    splitHBtn.title = 'Split Down';
    splitHBtn.innerHTML = '<i data-icon="rows-2"></i>';
    splitHBtn.dataset.action = 'split-horizontal';

    const closeBtn = createEl('button', 'dock-mini-btn');
    closeBtn.title = 'Close Pane';
    closeBtn.innerHTML = '<i data-icon="x"></i>';
    closeBtn.dataset.action = 'close';

    actionsEl.appendChild(extraActionsEl);
    actionsEl.appendChild(refreshBtn);
    actionsEl.appendChild(splitVBtn);
    actionsEl.appendChild(splitHBtn);
    actionsEl.appendChild(closeBtn);

    headerEl.appendChild(titleEl);
    headerEl.appendChild(actionsEl);

    const bodyEl = createEl('div', 'dock-leaf-body');

    leafEl.appendChild(headerEl);
    leafEl.appendChild(bodyEl);

    const leaf = { id, el: leafEl, headerEl, bodyEl, viewId: null, cleanup: null, iconEl, nameEl, refreshBtn, refresh: null, extraActionsEl };
    leaves.set(id, leaf);

    leafEl.addEventListener('pointerdown', (e) => {
      // Don’t steal clicks from buttons
      if (e.target && e.target.closest && e.target.closest('button')) return;
      setLeafActive(id);
    });

    actionsEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      setLeafActive(id);
      const action = btn.dataset.action;
      if (action && action.startsWith('terminal:')) {
        const actionId = action.slice('terminal:'.length);
        const handler = terminalActions.get(actionId);
        if (handler && typeof handler.onClick === 'function') {
          try {
            handler.onClick({
              anchorEl: btn,
              leafId: id,
              leaf,
              activeTab: state ? getActiveTab(state) : null
            });
          } catch (err) { }
        }
        return;
      }
      if (action === 'refresh') {
        const current = leaves.get(id);
        if (!current || !current.viewId || current.viewId === 'terminal') return;
        if (typeof current.refresh === 'function') {
          try { current.refresh(); } catch (err) { }
        } else {
          try {
            current.bodyEl.dispatchEvent(new CustomEvent('marinashell:refresh', { detail: { viewId: current.viewId } }));
          } catch (err) { }
        }
        return;
      }
      if (action === 'split-vertical') splitActive('vertical');
      if (action === 'split-horizontal') splitActive('horizontal');
      if (action === 'close') closeActive();
    });

    renderLucide(leafEl);
    return leaf;
  }

  function renderLeafExtraActions(leaf) {
    if (!leaf || !leaf.extraActionsEl) return;
    leaf.extraActionsEl.innerHTML = '';
    if (leaf.viewId !== 'terminal') {
      renderLucide(leaf.extraActionsEl);
      return;
    }
    for (const action of terminalActions.values()) {
      const btn = createEl('button', 'dock-mini-btn');
      btn.dataset.action = `terminal:${action.id}`;
      btn.title = action.title || action.id;
      btn.innerHTML = `<i data-icon="${action.icon || 'camera'}"></i>`;
      leaf.extraActionsEl.appendChild(btn);
    }
    renderLucide(leaf.extraActionsEl);
  }

  function setLeafTitle(leaf, viewInfo) {
    leaf.nameEl.textContent = viewInfo ? viewInfo.title : 'Empty';
    const cls = viewInfo && viewInfo.iconClass ? viewInfo.iconClass : 'icon-terminal';
    leaf.iconEl.className = `dock-icon ${cls}`;
    if (leaf.refreshBtn) {
      const eligible = Boolean(viewInfo && viewInfo.id && viewInfo.id !== 'terminal');
      leaf.refreshBtn.disabled = !eligible;
    }
    renderLeafExtraActions(leaf);
  }

  function clearLeaf(leaf) {
    try {
      if (leaf.cleanup) leaf.cleanup();
    } catch (err) {
    }
    leaf.cleanup = null;
    leaf.viewId = null;
    leaf.refresh = null;
    leaf.bodyEl.innerHTML = '';
    setLeafTitle(leaf, null);
  }

  function mountViewInLeaf(leafId, viewId, options = {}) {
    const leaf = leaves.get(leafId);
    if (!leaf) return;
    leaf.bodyEl.style.overflow = 'auto';
    if (!viewId) {
      clearLeaf(leaf);
      leaf.bodyEl.innerHTML = `
        <div style="padding: 18px; color: rgba(255,255,255,0.65);">
          <div style="font-weight: 650; color: rgba(255,255,255,0.92); margin-bottom: 6px;">Pick a view</div>
          <div style="line-height: 1.45;">Use the toolbar to open Terminal or any plugin.</div>
        </div>
      `;
      renderLeafExtraActions(leaf);
      return;
    }

    const view = views.get(viewId);
    if (!view) return;

    clearLeaf(leaf);
    leaf.viewId = viewId;
    setLeafTitle(leaf, view);

    // Special-case terminal: move the existing terminal stack into this pane.
    if (viewId === 'terminal') {
      for (const [otherId, otherLeaf] of leaves.entries()) {
        if (otherId !== leafId && otherLeaf.viewId === 'terminal') {
          clearLeaf(otherLeaf);
          otherLeaf.bodyEl.innerHTML = `
            <div style="padding: 18px; color: rgba(255,255,255,0.65);">
              <div style="font-weight: 650; color: rgba(255,255,255,0.92); margin-bottom: 6px;">Terminal moved</div>
              <div style="line-height: 1.45;">Use the toolbar to open a view in this pane.</div>
            </div>
          `;
          renderLeafExtraActions(otherLeaf);
        }
      }
      leaf.bodyEl.style.overflow = 'hidden';
      leaf.bodyEl.appendChild(terminalStackEl);
      leaf.cleanup = () => {
        // No-op: terminal is a singleton; it will be moved elsewhere on next mount.
      };

      // Fit terminal when the pane resizes.
      const ro = new ResizeObserver(() => {
        try {
          sessionTabs.fitActiveTerminal();
        } catch (err) { }
      });
      ro.observe(leaf.bodyEl);
      leaf.cleanup = () => {
        try { ro.disconnect(); } catch (err) { }
      };

      // Initial fit
      try {
        sessionTabs.fitActiveTerminal();
      } catch (err) { }
      renderLeafExtraActions(leaf);
      return;
    }

    const mountOptions = {
      ...(options || {}),
      setRefresh: (fn) => {
        leaf.refresh = typeof fn === 'function' ? fn : null;
        if (leaf.refreshBtn) {
          leaf.refreshBtn.disabled = !(leaf.viewId && leaf.viewId !== 'terminal');
        }
      }
    };

    const cleanup = view.mount(leaf.bodyEl, mountOptions) || null;
    leaf.cleanup = typeof cleanup === 'function' ? () => {
      leaf.refresh = null;
      try { cleanup(); } catch (err) { }
    } : () => { leaf.refresh = null; };
    renderLeafExtraActions(leaf);
  }

  function replaceNode(oldNodeEl, newNodeEl) {
    const parent = oldNodeEl.parentElement;
    if (!parent) return;
    parent.replaceChild(newNodeEl, oldNodeEl);
  }

  function wireResizer(splitEl, firstEl, secondEl, orientation) {
    const resizer = createEl('div', 'dock-resizer');
    splitEl.insertBefore(resizer, secondEl);

    let dragging = false;
    let start = 0;
    let startSize = 0;
    let totalSize = 0;

    const axis = orientation === 'vertical' ? 'x' : 'y';
    const sizeProp = orientation === 'vertical' ? 'width' : 'height';

    resizer.addEventListener('pointerdown', (e) => {
      dragging = true;
      resizer.setPointerCapture(e.pointerId);
      start = axis === 'x' ? e.clientX : e.clientY;
      totalSize = splitEl.getBoundingClientRect()[sizeProp] || 0;
      startSize = firstEl.getBoundingClientRect()[sizeProp] || 0;
      e.preventDefault();
    });

    resizer.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const delta = pos - start;
      if (!totalSize) return;
      const next = Math.max(120, Math.min(totalSize - 120, startSize + delta));
      const pct = Math.max(0.15, Math.min(0.85, next / totalSize));
      firstEl.style.flex = `0 0 ${Math.round(pct * 1000) / 10}%`;
      secondEl.style.flex = '1 1 0';
      try {
        sessionTabs.fitActiveTerminal();
      } catch (err) { }
    });

    resizer.addEventListener('pointerup', () => {
      dragging = false;
    });

    resizer.addEventListener('pointercancel', () => {
      dragging = false;
    });
  }

  function splitLeaf(leafId, orientation, newLeafPreferred = true) {
    const leaf = leaves.get(leafId);
    if (!leaf) return null;

    const parent = leaf.el.parentElement;
    const isRoot = parent === rootEl;

    // Wrap the leaf inside a split container, along with a new leaf.
    // Avoid `row`/`column` class names because the app already defines `.row` for form layouts.
    const splitEl = createEl('div', `dock-split ${orientation === 'vertical' ? 'dock-row' : 'dock-col'}`);
    const newLeaf = buildLeaf();

    // Default layout: 50/50.
    leaf.el.style.flex = '1 1 0';
    newLeaf.el.style.flex = '1 1 0';

    if (isRoot) {
      rootEl.innerHTML = '';
      rootEl.appendChild(splitEl);
    } else if (parent) {
      parent.replaceChild(splitEl, leaf.el);
    }

    splitEl.appendChild(leaf.el);
    splitEl.appendChild(newLeaf.el);

    // Insert resizer between the two panes.
    wireResizer(splitEl, leaf.el, newLeaf.el, orientation);

    // Focus the new leaf by default.
    setLeafActive(newLeafPreferred ? newLeaf.id : leafId);
    mountViewInLeaf(newLeaf.id, null);
    return newLeaf.id;
  }

  function splitActive(orientation) {
    const leafId = ensureLeafSelected();
    if (!leafId) return;
    splitLeaf(leafId, orientation);
  }

  function resetLayoutToSingle(viewId) {
    // Tear down all leaves and rebuild a single-pane layout.
    for (const [, leaf] of leaves.entries()) {
      clearLeaf(leaf);
    }
    leaves.clear();
    leafCounter = 0;
    activeLeafId = null;

    rootEl.innerHTML = '';
    const rootLeaf = buildLeaf();
    rootEl.appendChild(rootLeaf.el);
    setLeafActive(rootLeaf.id);
    mountViewInLeaf(rootLeaf.id, viewId || 'terminal');
  }

  function closeLeaf(leafId) {
    const leaf = leaves.get(leafId);
    if (!leaf) return;

    clearLeaf(leaf);

    const parent = leaf.el.parentElement;
    if (!parent) return;

    // If we're the only leaf, reset to terminal.
    if (rootEl.contains(leaf.el) && leaves.size === 1) {
      mountViewInLeaf(leafId, 'terminal');
      setLeafActive(leafId);
      return;
    }

    // If parent is a split container, collapse it.
    const splitEl = parent.classList && parent.classList.contains('dock-split') ? parent : null;
    if (splitEl) {
      const siblings = Array.from(splitEl.children).filter((c) => c.classList && c.classList.contains('dock-leaf'));
      const remaining = siblings.find((c) => c !== leaf.el) || null;

      // Remove our leaf DOM
      try { splitEl.removeChild(leaf.el); } catch (err) { }
      leaves.delete(leafId);

      if (remaining) {
        // Remove resizer too
        Array.from(splitEl.children).forEach((c) => {
          if (c.classList && c.classList.contains('dock-resizer')) splitEl.removeChild(c);
        });

        // Replace split with remaining leaf
        const splitParent = splitEl.parentElement;
        if (splitParent === rootEl) {
          rootEl.innerHTML = '';
          rootEl.appendChild(remaining);
        } else if (splitParent) {
          splitParent.replaceChild(remaining, splitEl);
        }
      }
    } else {
      // No split parent; just remove.
      try { parent.removeChild(leaf.el); } catch (err) { }
      leaves.delete(leafId);
    }

    const next = ensureLeafSelected();
    if (next) setLeafActive(next);
  }

  function closeActive() {
    const leafId = ensureLeafSelected();
    if (!leafId) return;
    closeLeaf(leafId);
  }

  function syncToolbarActiveState() {
    if (!toolbarViewsEl) return;
    const leafId = ensureLeafSelected();
    const leaf = leafId ? leaves.get(leafId) : null;
    const activeView = leaf ? leaf.viewId : null;
    const activeTab = state ? getActiveTab(state) : null;
    const sessionType = activeTab && activeTab.sessionType ? String(activeTab.sessionType) : '';
    const normalizedType = sessionType === 'local' ? 'local' : (sessionType === 'ssh' ? 'ssh' : sessionType);
    toolbarViewsEl.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === activeView);
      const viewInfo = views.get(btn.dataset.view) || null;
      if (!viewInfo || viewInfo.id === 'terminal') {
        btn.disabled = false;
        return;
      }
      if (viewInfo.requiresConnection === false) {
        btn.disabled = false;
        return;
      }
      if (!activeTab || !activeTab.connected) {
        btn.disabled = true;
        return;
      }
      const supports = viewInfo.supports;
      if (Array.isArray(supports) && supports.length) {
        btn.disabled = !supports.includes(normalizedType);
      } else {
        btn.disabled = false;
      }
    });
  }

  function addToolbarButton(viewInfo) {
    if (!toolbarViewsEl) return;
    if (toolbarViewsEl.querySelector(`[data-view="${viewInfo.id}"]`)) return;

    const btn = createEl('button', 'tool-btn');
    btn.dataset.view = viewInfo.id;

    const icon = createEl('span', `dock-icon ${viewInfo.iconClass || ''}`);
    btn.appendChild(icon);
    const label = createEl('span');
    label.textContent = viewInfo.title;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      const leafId = ensureLeafSelected();
      if (!leafId) return;
      const leaf = leaves.get(leafId);
      if (!leaf) return;

      // Default behavior:
      // - Single-pane layout: open the view full-window (replace the current view).
      // - Split layout: open the view in the active pane (user explicitly created splits).
      if (leaves.size <= 1) {
        resetLayoutToSingle(viewInfo.id);
        return;
      }

      mountViewInLeaf(leafId, viewInfo.id);
      setLeafActive(leafId);
    });

    toolbarViewsEl.appendChild(btn);
    syncToolbarActiveState();
    renderLucide(toolbarViewsEl);
  }

  function registerView(id, info) {
    if (!id) return;
    const viewInfo = {
      id,
      title: info && info.title ? info.title : id,
      iconClass: info && info.iconClass ? info.iconClass : '',
      mount: info && typeof info.mount === 'function' ? info.mount : () => null,
      supports: info && Array.isArray(info.supports) ? info.supports : null,
      requiresConnection: info && Object.prototype.hasOwnProperty.call(info, 'requiresConnection')
        ? Boolean(info.requiresConnection)
        : true
    };
    views.set(id, viewInfo);
    addToolbarButton(viewInfo);
  }

  function initRoot() {
    rootEl.innerHTML = '';
    const rootLeaf = buildLeaf();
    rootEl.appendChild(rootLeaf.el);
    setLeafActive(rootLeaf.id);
    renderLucide(rootEl);
    return rootLeaf.id;
  }

  // Public API
  const api = {
    registerView,
    registerTerminalAction: (id, info) => {
      if (!id) return;
      const actionInfo = {
        id,
        title: info && info.title ? info.title : id,
        icon: info && info.icon ? info.icon : 'camera',
        onClick: info && typeof info.onClick === 'function' ? info.onClick : null
      };
      terminalActions.set(id, actionInfo);
      for (const leaf of leaves.values()) {
        if (leaf.viewId === 'terminal') renderLeafExtraActions(leaf);
      }
    },
    mountViewInActive: (viewId, options) => {
      const leafId = ensureLeafSelected();
      if (!leafId) return;
      mountViewInLeaf(leafId, viewId, options);
      setLeafActive(leafId);
    },
    splitVertical: () => splitActive('vertical'),
    splitHorizontal: () => splitActive('horizontal'),
    closeActive,
    resetLayout: () => {
      const leafId = ensureLeafSelected();
      const viewId = leafId && leaves.get(leafId) ? leaves.get(leafId).viewId : 'terminal';
      resetLayoutToSingle(viewId || 'terminal');
    },
    getActiveLeaf: () => {
      const id = ensureLeafSelected();
      return id ? leaves.get(id) : null;
    }
  };

  // Initialize the first pane.
  const rootLeafId = initRoot();

  // Register terminal view and mount it by default.
  registerView('terminal', {
    title: 'Terminal',
    iconClass: 'icon-terminal',
    mount: (container) => {
      container.appendChild(terminalStackEl);
      return null;
    }
  });
  mountViewInLeaf(rootLeafId, 'terminal');
  setLeafActive(rootLeafId);

  window.addEventListener('marinashell:active-tab-changed', () => {
    syncToolbarActiveState();
  });
  window.addEventListener('marinashell:session-state-changed', () => {
    syncToolbarActiveState();
  });

  // Add split controls to toolbar (optional, but useful).
  if (toolbarActionsEl) {
    const sep = createEl('span');
    sep.style.width = '1px';
    sep.style.height = '22px';
    sep.style.background = 'rgba(255,255,255,0.10)';
    sep.style.margin = '0 4px';
    toolbarActionsEl.appendChild(sep);

    const splitV = createEl('button', 'tool-btn');
    splitV.title = 'Split Right';
    splitV.innerHTML = `<i data-icon="columns-2"></i><span>Split</span>`;
    splitV.addEventListener('click', () => api.splitVertical());
    toolbarActionsEl.appendChild(splitV);

    const splitH = createEl('button', 'tool-btn');
    splitH.title = 'Split Down';
    splitH.innerHTML = `<i data-icon="rows-2"></i><span>Split</span>`;
    splitH.addEventListener('click', () => api.splitHorizontal());
    toolbarActionsEl.appendChild(splitH);

    const close = createEl('button', 'tool-btn');
    close.title = 'Close Active Pane';
    close.innerHTML = `<i data-icon="x"></i><span>Close</span>`;
    close.addEventListener('click', () => api.closeActive());
    toolbarActionsEl.appendChild(close);

    const reset = createEl('button', 'tool-btn');
    reset.title = 'Reset to single pane';
    reset.innerHTML = `<i data-icon="square"></i><span>Single</span>`;
    reset.addEventListener('click', () => api.resetLayout());
    toolbarActionsEl.appendChild(reset);

    renderLucide(toolbarActionsEl);
  }

  return api;
}
