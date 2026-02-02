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

function injectStyles() {
  if (document.getElementById('screenshot-terminal-style')) return;
  const style = document.createElement('style');
  style.id = 'screenshot-terminal-style';
  style.textContent = `
    .shot-menu {
      position: fixed;
      z-index: 9999;
      min-width: 220px;
      max-width: min(420px, calc(100vw - 24px));
      padding: 6px;
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

    .shot-menu .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      cursor: pointer;
      color: rgba(255,255,255,0.86);
    }
    .shot-menu .row:hover { background: rgba(255,255,255,0.06); }
    .shot-menu .row:active { background: rgba(255,255,255,0.10); }
    .shot-menu .row.disabled { opacity: 0.55; cursor: default; pointer-events: none; }
    .shot-menu .row .meta { margin-left: auto; color: rgba(255,255,255,0.45); font-size: 11px; }

    .shot-toast {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 9999;
      background: rgba(15, 19, 32, 0.96);
      border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.88);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.35;
      max-width: min(520px, calc(100vw - 28px));
      pointer-events: none;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 140ms ease, transform 140ms ease;
    }
    .shot-toast.show { opacity: 1; transform: translateY(0); }
    .shot-toast.bad { border-color: rgba(243, 139, 168, 0.28); color: #f38ba8; }
  `;
  document.head.appendChild(style);
}

export default function (context) {
  const { api, registerTerminalAction } = context || {};
  if (!api || typeof api.invoke !== 'function') return;
  if (typeof registerTerminalAction !== 'function') return;

  injectStyles();

  let menuEl = null;
  let toastEl = null;
  let toastTimer = null;
  let inFlight = false;
  let lastAnchorEl = null;

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'shot-toast';
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function showToast(message, tone) {
    const el = ensureToast();
    el.textContent = message;
    el.classList.toggle('bad', tone === 'bad');
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

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
    // Place under the button, right-aligned, clamped to viewport.
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

  async function invoke(kind) {
    return api.invoke(`plugin:screenshot:${kind}`, {});
  }

  async function runAction(kind) {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await invoke(kind);
      if (res && res.ok) {
        if (kind === 'copy') showToast('Screenshot copied to clipboard');
        if (kind === 'saveDocuments') showToast('Saved to Documents');
        if (kind === 'saveAs') showToast('Saved screenshot');
      } else if (res && res.canceled) {
        showToast('Save canceled');
      } else {
        showToast((res && res.error) ? String(res.error) : 'Screenshot failed', 'bad');
      }
    } catch (err) {
      showToast(err && err.message ? err.message : 'Screenshot failed', 'bad');
    } finally {
      inFlight = false;
      closeMenu();
    }
  }

  function openMenu(anchorEl) {
    if (menuEl) {
      closeMenu();
      return;
    }
    lastAnchorEl = anchorEl;
    menuEl = document.createElement('div');
    menuEl.className = 'shot-menu';
    menuEl.innerHTML = `
      <div class="row" data-action="copy">
        <i data-icon="copy"></i>
        <div>Copy to clipboard</div>
        <div class="meta">⌘C</div>
      </div>
      <div class="row" data-action="saveAs">
        <i data-icon="save"></i>
        <div>Save As…</div>
      </div>
      <div class="row" data-action="saveDocuments">
        <i data-icon="folder-down"></i>
        <div>Save to Documents</div>
      </div>
    `;
    document.body.appendChild(menuEl);
    renderLucide(menuEl);
    // Need layout to compute width/height for positioning.
    positionMenu(anchorEl);

    menuEl.addEventListener('click', (e) => {
      const row = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!row) return;
      const kind = row.getAttribute('data-action');
      if (!kind) return;
      runAction(kind);
    });
  }

  function isEventInsideMenu(event) {
    if (!menuEl) return false;
    const target = event && event.target;
    if (!target || !target.closest) return false;
    return Boolean(target.closest('.shot-menu'));
  }

  function isEventOnAnchor(event) {
    const target = event && event.target;
    if (!target || !target.closest) return false;
    if (!lastAnchorEl) return false;
    return lastAnchorEl.contains(target);
  }

  window.addEventListener('pointerdown', (e) => {
    if (!menuEl) return;
    if (isEventInsideMenu(e)) return;
    if (isEventOnAnchor(e)) return;
    closeMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (!menuEl) return;
    if (e.key === 'Escape') {
      closeMenu();
      return;
    }
    // Quick shortcut when menu open: C to copy.
    if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runAction('copy');
    }
  });

  window.addEventListener('resize', () => {
    if (!menuEl || !lastAnchorEl) return;
    positionMenu(lastAnchorEl);
  });

  registerTerminalAction('screenshot', {
    title: 'Screenshot',
    icon: 'camera',
    onClick: ({ anchorEl }) => {
      openMenu(anchorEl);
    }
  });
}

