import '../services/dockingModel.js';
const M = globalThis.MarinaDocking;
let drag = null;
const surfaces = new Set();

function stopDrag(committed = false) {
  if (!drag) return;
  const current = drag; drag = null;
  for (const surface of surfaces) surface.clearPreview();
  current.element.classList.remove('docking-drag-source');
  document.body.classList.remove('docking-dragging');
  if (current.started) current.owner.dragEnd?.({ committed, started: true });
}

document.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  if (!drag.started) {
    drag.started = true; drag.element.classList.add('docking-drag-source');
    document.body.classList.add('docking-dragging'); drag.owner.dragStart?.(drag.key);
  }
  event.preventDefault(); drag.destination = null;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const scrollStrip = target?.closest('#session-tabs, .docking-pane-tabs');
  if (scrollStrip) {
    const bounds = scrollStrip.getBoundingClientRect();
    if (event.clientX < bounds.left + 24) scrollStrip.scrollLeft -= 24;
    else if (event.clientX > bounds.right - 24) scrollStrip.scrollLeft += 24;
  }
  const tab = target?.closest('[data-dock-reorder]');
  for (const surface of surfaces) surface.clearPreview();
  if (tab && tab.dataset.dockKind === drag.kind && tab.dataset.dockGroup === drag.group && drag.owner.reorder) {
    const rect = tab.getBoundingClientRect();
    tab.classList.add('drag-over');
    drag.destination = { reorder: tab.dataset.dockMember, after: event.clientX > rect.left + rect.width / 2 };
    return;
  }
  for (const surface of surfaces) {
    if (surface.kind !== drag.kind || surface.group() !== drag.group || !surface.root.contains(target)) continue;
    const destination = surface.preview(drag.key, event.clientX, event.clientY);
    if (destination) drag.destination = { surface, ...destination };
    break;
  }
}, { passive: false });

document.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started) { stopDrag(); return; }
  event.preventDefault();
  const current = drag, destination = current.destination;
  // Suppress the click produced by releasing a completed/cancelled drag.
  const swallow = click => { click.preventDefault(); click.stopImmediatePropagation(); };
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, true), 0);
  let committed = false;
  try {
    if (destination?.reorder) committed = current.owner.reorder(current.key, destination.reorder, destination.after) !== false;
    else if (destination?.surface) committed = destination.surface.commit(current.key, destination) !== false;
  } catch (error) { current.owner.error?.(error); }
  stopDrag(committed);
});
document.addEventListener('pointercancel', () => stopDrag());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); stopDrag(); } });
window.addEventListener('blur', () => stopDrag());

export function bindPaneDrag(element, owner, key, { reorder = false } = {}) {
  element.draggable = false;
  element.dataset.dockMember = key;
  element.dataset.dockKind = owner.kind;
  element.dataset.dockGroup = owner.group();
  if (reorder) element.dataset.dockReorder = 'true';
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.close-btn, [data-no-drag]')) return;
    drag = { element, owner, key, kind: owner.kind, group: owner.group(), pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false };
  });
}

export function createPaneDocking({ root, kind, group, getModel, setModel, getMember, getLabel, activate, close, contextMenu, fit, dragStart, dragEnd, reorder, error }) {
  root.classList.add('pane-dock-surface'); root.dataset.dockKind = kind;
  const parking = document.createElement('div'); parking.hidden = true; root.append(parking);
  const empty = document.createElement('div'); empty.className = 'pane-dock-empty';
  empty.textContent = kind === 'terminal' ? 'Drag a terminal here to dock it' : 'Show an output from Run configurations'; root.append(empty);
  const overlay = document.createElement('div'); overlay.className = 'docking-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="docking-preview"></div><div class="docking-anchors"><span data-anchor="above">↑</span><span data-anchor="left">←</span><span data-anchor="centre">▣</span><span data-anchor="right">→</span><span data-anchor="below">↓</span></div><div class="docking-hint"></div>';
  root.append(overlay);
  const panes = new Map(), dividerElements = new Map();
  const owner = { root, kind, group, dragStart, dragEnd, reorder, error, clearPreview, preview, commit };
  surfaces.add(owner);
  let displayedGeometry = { panes: [], dividers: [] };
  const resizeObserver = new ResizeObserver(() => fit?.());
  resizeObserver.observe(root);
  const position = (el, rect) => Object.assign(el.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

  function render(model = getModel(), activeKey = '') {
    displayedGeometry = M.geometry(model);
    empty.hidden = Boolean(displayedGeometry.panes.length);
    const retained = new Set();
    for (const rect of displayedGeometry.panes) {
      const p = rect.pane; retained.add(p.id);
      let view = panes.get(p.id);
      if (!view) {
        const el = document.createElement('section'); el.className = 'docking-pane'; el.dataset.paneId = p.id;
        const header = document.createElement('div'); header.className = 'docking-pane-tabs'; header.setAttribute('role', 'tablist');
        const body = document.createElement('div'); body.className = 'docking-pane-body';
        el.append(header, body); root.append(el); view = { el, header, body }; panes.set(p.id, view);
      }
      position(view.el, rect); view.el.classList.toggle('focused', p.memberIds.includes(activeKey));
      view.header.replaceChildren();
      for (const key of p.memberIds) {
        const member = getMember(key); if (!member) continue;
        const selected = key === p.activeId;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'docking-member';
        button.dataset.memberId = key; button.textContent = getLabel(key); button.title = getLabel(key);
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(selected));
        button.classList.toggle('active', selected); button.addEventListener('click', () => activate(key));
        if (contextMenu) button.addEventListener('contextmenu', event => { event.preventDefault(); contextMenu(event, key); });
        bindPaneDrag(button, owner, key);
        if (close) {
          const x = document.createElement('span'); x.className = 'close-btn'; x.textContent = '×'; x.setAttribute('role', 'button'); x.tabIndex = 0;
          x.setAttribute('aria-label', `Close ${getLabel(key)}`);
          x.addEventListener('click', event => { event.stopPropagation(); close(key); });
          x.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); close(key); } });
          button.append(x);
        }
        view.header.append(button);
        if (member.container.parentElement !== view.body) view.body.append(member.container);
        member.container.hidden = !selected;
        member.container.classList.toggle('grid-visible', selected);
        member.container.classList.toggle('active', selected && key === activeKey);
      }
      // Move removed/inactive members into a hidden host without disposing xterm.
      for (const child of [...view.body.children]) {
        const key = child.dataset.memberKey;
        if (key && !p.memberIds.includes(key)) { child.hidden = true; child.classList.remove('grid-visible', 'active'); parking.append(child); }
      }
    }
    for (const [paneId, view] of panes) if (!retained.has(paneId)) {
      for (const child of [...view.body.children]) { child.hidden = true; child.classList.remove('grid-visible', 'active'); parking.append(child); }
      view.el.remove(); panes.delete(paneId);
    }
    renderDividers();
    requestAnimationFrame(() => fit?.());
  }

  function renderDividers() {
    const retained = new Set();
    for (const rect of displayedGeometry.dividers) {
      const split = rect.node; retained.add(split.id);
      let divider = dividerElements.get(split.id);
      if (!divider) {
        divider = document.createElement('div'); divider.className = 'pane-divider'; divider.dataset.splitId = split.id;
        divider.setAttribute('role', 'separator'); divider.tabIndex = 0; root.append(divider); dividerElements.set(split.id, divider);
        divider.addEventListener('pointerdown', event => startResize(event, split.id));
        divider.addEventListener('keydown', event => {
          const current = M.geometry(getModel()).dividers.find(d => d.node.id === split.id);
          if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -0.05 : 0.05;
          const bounds = root.getBoundingClientRect(), row = current.node.axis === 'row';
          const minimum = Math.min(0.45, (row ? 200 : 120) / (row ? current.width * bounds.width : current.height * bounds.height));
          const ratio = Math.max(minimum, Math.min(1 - minimum, current.node.ratio + delta));
          setModel(M.resize(getModel(), split.id, ratio), { persist: true });
        });
      }
      divider.dataset.axis = split.axis;
      divider.setAttribute('aria-label', 'Resize panes'); divider.setAttribute('aria-orientation', split.axis === 'row' ? 'vertical' : 'horizontal');
      divider.setAttribute('aria-valuenow', String(Math.round(split.ratio * 100)));
      position(divider, { ...rect, width: split.axis === 'row' ? 0 : rect.width, height: split.axis === 'column' ? 0 : rect.height });
    }
    for (const [key, el] of dividerElements) if (!retained.has(key)) { el.remove(); dividerElements.delete(key); }
  }

  function startResize(event, splitId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const original = M.copy(getModel()), rect = M.geometry(original).dividers.find(d => d.node.id === splitId);
    if (!rect) return;
    const bounds = root.getBoundingClientRect(), row = rect.node.axis === 'row';
    const origin = row ? bounds.left + rect.x * bounds.width - rect.node.ratio * rect.width * bounds.width : bounds.top + rect.y * bounds.height - rect.node.ratio * rect.height * bounds.height;
    const total = (row ? rect.width * bounds.width : rect.height * bounds.height);
    const minimum = Math.min(0.45, (row ? 200 : 120) / total);
    const move = e => {
      const ratio = Math.max(minimum, Math.min(1 - minimum, ((row ? e.clientX : e.clientY) - origin) / total));
      setModel(M.resize(original, splitId, ratio), { persist: false });
    };
    const end = () => { cleanup(); setModel(getModel(), { persist: true }); };
    const cancel = () => { cleanup(); setModel(original, { persist: false }); };
    const key = e => { if (e.key === 'Escape') cancel(); };
    const cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key); window.removeEventListener('blur', cancel); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end, { once: true });
    document.addEventListener('pointercancel', cancel, { once: true }); document.addEventListener('keydown', key); window.addEventListener('blur', cancel, { once: true });
  }

  function clearPreview() {
    overlay.hidden = true;
    document.querySelectorAll('[data-dock-reorder].drag-over').forEach(el => el.classList.remove('drag-over'));
  }
  function preview(key, x, y) {
    const bounds = root.getBoundingClientRect(); if (!bounds.width || !bounds.height) return null;
    const nx = (x - bounds.left) / bounds.width, ny = (y - bounds.top) / bounds.height;
    const target = displayedGeometry.panes.find(p => nx >= p.x && nx <= p.x + p.width && ny >= p.y && ny <= p.y + p.height);
    let zone = 'centre';
    if (target) {
      const cx = bounds.left + (target.x + target.width / 2) * bounds.width, cy = bounds.top + (target.y + target.height / 2) * bounds.height;
      // The anchors and the outer quarters of the pane both select an edge.
      const dx = x - cx, dy = y - cy;
      if (Math.abs(dx) <= 60 && Math.abs(dy) <= 60) {
        if (Math.abs(dx) > 20 || Math.abs(dy) > 20) zone = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'above' : 'below');
      } else {
        const distances = { left: (nx - target.x) / target.width, right: (target.x + target.width - nx) / target.width, above: (ny - target.y) / target.height, below: (target.y + target.height - ny) / target.height };
        const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0];
        if (edge[1] < 0.25) zone = edge[0];
      }
      overlay.querySelector('.docking-anchors').style.left = `${(target.x + target.width / 2) * 100}%`;
      overlay.querySelector('.docking-anchors').style.top = `${(target.y + target.height / 2) * 100}%`;
    }
    try {
      const model = getModel(), next = M.dock(model, key, target?.pane.id || '', zone, kind);
      if (JSON.stringify(next) === JSON.stringify(model)) { clearPreview(); return null; }
      const result = M.geometry(next).panes.find(p => p.pane.memberIds.includes(key));
      if (!result || (zone !== 'centre' && (result.width * bounds.width < 200 || result.height * bounds.height < 120))) throw new Error('Not enough room for this split');
      position(overlay.querySelector('.docking-preview'), result);
      overlay.querySelector('.docking-anchors').hidden = !target;
      overlay.querySelectorAll('[data-anchor]').forEach(el => el.classList.toggle('selected', el.dataset.anchor === zone));
      overlay.querySelector('.docking-hint').textContent = zone === 'centre' ? (target ? 'Group here' : 'Dock here') : `Dock ${zone}`;
      overlay.classList.remove('invalid'); overlay.hidden = false;
      return { paneId: target?.pane.id || '', zone, next };
    } catch (failure) {
      if (target) position(overlay.querySelector('.docking-preview'), target);
      overlay.querySelector('.docking-hint').textContent = failure.message;
      overlay.classList.add('invalid'); overlay.hidden = false; return null;
    }
  }
  function commit(key, destination) {
    // Recompute against current state: a close/restart may have happened mid-drag.
    const next = M.dock(getModel(), key, destination.paneId, destination.zone, kind);
    if (!getMember(key)) return false;
    const bounds = root.getBoundingClientRect(), pane = M.geometry(next).panes.find(p => p.pane.memberIds.includes(key));
    if (destination.zone !== 'centre' && (!pane || pane.width * bounds.width < 200 || pane.height * bounds.height < 120)) return false;
    setModel(next, { persist: true }); activate(key); return true;
  }
  return { ...owner, render, bind: (el, key, options) => bindPaneDrag(el, owner, key, options), destroy: () => { resizeObserver.disconnect(); surfaces.delete(owner); root.replaceChildren(); } };
}
