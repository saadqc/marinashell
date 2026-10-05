// Shared, pure layout operations. Loaded as a side-effect module in Chromium
// and required by project validation/tests in Node; neither path needs the DOM.
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.MarinaDocking = model;
})(globalThis, function () {
  const id = () => globalThis.crypto?.randomUUID?.() || `pane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const copy = value => JSON.parse(JSON.stringify(value));
  const pane = members => ({ type: 'pane', id: id(), memberIds: [...members], activeId: members[0] || '' });
  const empty = kind => ({ version: 1, kind, root: null, standaloneIds: [] });
  const near = (a, b) => Math.abs(a - b) < 1e-8;

  function leaves(node) {
    if (!node) return [];
    if (node.type === 'pane') return [node];
    if (node.type === 'grid') return node.cells.flatMap(cell => leaves(cell.node));
    return [...leaves(node.first), ...leaves(node.second)];
  }
  const find = (model, member) => leaves(model.root).find(p => p.memberIds.includes(member));
  const members = model => [...leaves(model.root).flatMap(p => p.memberIds), ...model.standaloneIds];

  function validate(model, kind = model?.kind) {
    if (!model || model.version !== 1 || !['terminal', 'configuration'].includes(kind) || model.kind !== kind || !Array.isArray(model.standaloneIds)) throw new Error('Invalid docking layout.');
    const seen = new Set(), nodeIds = new Set();
    const member = key => {
      if (typeof key !== 'string' || !key || key.length > 200 || seen.has(key)) throw new Error('Invalid or duplicate pane member.');
      seen.add(key);
    };
    function visit(node, depth = 0) {
      if (!node) return;
      if (depth > 64) throw new Error('Docking layout is too deep.');
      if (node.type !== 'grid') {
        if (typeof node.id !== 'string' || !node.id || node.id.length > 200 || nodeIds.has(node.id)) throw new Error('Invalid or duplicate docking node.');
        nodeIds.add(node.id);
      }
      if (node.type === 'pane') {
        if (!Array.isArray(node.memberIds) || !node.memberIds.length || !node.memberIds.includes(node.activeId)) throw new Error('Invalid docking pane.');
        node.memberIds.forEach(member);
      } else if (node.type === 'split') {
        if (!node.first || !node.second || !['row', 'column'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1 || typeof node.id !== 'string') throw new Error('Invalid docking split.');
        visit(node.first, depth + 1); visit(node.second, depth + 1);
      } else if (node.type === 'grid') {
        if (!Array.isArray(node.cells) || !node.cells.length || node.cells.length > 32) throw new Error('Invalid legacy docking grid.');
        for (const cell of node.cells) {
          if (![cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) || cell.x < 0 || cell.y < 0 || cell.width <= 0 || cell.height <= 0 || cell.x + cell.width > 1 + 1e-8 || cell.y + cell.height > 1 + 1e-8) throw new Error('Invalid legacy pane bounds.');
          visit(cell.node, depth + 1);
        }
        if (node.cells.some((a, i) => node.cells.slice(i + 1).some(b => a.x < b.x + b.width - 1e-8 && b.x < a.x + a.width - 1e-8 && a.y < b.y + b.height - 1e-8 && b.y < a.y + a.height - 1e-8))) throw new Error('Legacy panes overlap.');
      } else throw new Error('Unknown docking node.');
    }
    visit(model.root);
    if (kind === 'configuration' && model.standaloneIds.length) throw new Error('Configuration outputs must stay in their own panes.');
    model.standaloneIds.forEach(member);
    if (seen.size > 32) throw new Error('A workspace supports up to 32 sessions.');
    return model;
  }

  function mapNode(node, fn) {
    if (!node) return null;
    if (node.type === 'pane') return fn(node);
    if (node.type === 'grid') {
      const cells = node.cells.map(cell => ({ ...cell, node: mapNode(cell.node, fn) })).filter(cell => cell.node);
      if (!cells.length) return null;
      if (cells.length === 1) return cells[0].node;
      // Heal rectangular holes where a removed cell shares a complete edge.
      const holes = node.cells.filter(cell => !cells.some(c => c.x === cell.x && c.y === cell.y));
      for (const hole of holes) {
        const neighbor = cells.find(c => (near(c.y, hole.y) && near(c.height, hole.height) && (near(c.x + c.width, hole.x) || near(hole.x + hole.width, c.x))) || (near(c.x, hole.x) && near(c.width, hole.width) && (near(c.y + c.height, hole.y) || near(hole.y + hole.height, c.y))));
        if (neighbor) {
          const right = Math.max(neighbor.x + neighbor.width, hole.x + hole.width), bottom = Math.max(neighbor.y + neighbor.height, hole.y + hole.height);
          neighbor.x = Math.min(neighbor.x, hole.x); neighbor.y = Math.min(neighbor.y, hole.y);
          neighbor.width = right - neighbor.x; neighbor.height = bottom - neighbor.y;
        }
      }
      return { ...node, cells };
    }
    const first = mapNode(node.first, fn), second = mapNode(node.second, fn);
    return first && second ? { ...node, first, second } : first || second;
  }

  function remove(model, member) {
    const next = copy(model);
    next.standaloneIds = next.standaloneIds.filter(key => key !== member);
    next.root = mapNode(next.root, p => {
      p.memberIds = p.memberIds.filter(key => key !== member);
      if (!p.memberIds.length) return null;
      if (!p.memberIds.includes(p.activeId)) p.activeId = p.memberIds[0];
      return p;
    });
    return next;
  }

  function geometry(model) {
    const panes = [], dividers = [];
    function walk(node, rect = { x: 0, y: 0, width: 1, height: 1 }) {
      if (!node) return;
      if (node.type === 'pane') { panes.push({ ...rect, pane: node }); return; }
      if (node.type === 'grid') {
        for (const cell of node.cells) walk(cell.node, { x: rect.x + cell.x * rect.width, y: rect.y + cell.y * rect.height, width: cell.width * rect.width, height: cell.height * rect.height });
        return;
      }
      const first = { ...rect }, second = { ...rect };
      if (node.axis === 'row') { first.width *= node.ratio; second.x += first.width; second.width *= 1 - node.ratio; }
      else { first.height *= node.ratio; second.y += first.height; second.height *= 1 - node.ratio; }
      dividers.push({ ...rect, node, x: node.axis === 'row' ? second.x : rect.x, y: node.axis === 'column' ? second.y : rect.y });
      walk(node.first, first); walk(node.second, second);
    }
    walk(model.root);
    panes.sort((a, b) => near(a.y, b.y) ? a.x - b.x : a.y - b.y);
    return { panes, dividers };
  }
  const order = model => [...geometry(model).panes.flatMap(({ pane: p }) => p.memberIds), ...model.standaloneIds];

  function dock(model, member, targetId, zone = 'centre', kind = model.kind) {
    validate(model, kind);
    if (!['centre', 'left', 'right', 'above', 'below'].includes(zone)) throw new Error('Invalid docking anchor.');
    const source = find(model, member);
    if (source?.id === targetId && (zone === 'centre' || source.memberIds.length === 1)) return copy(model);
    const next = remove(model, member);
    if (!next.root) { next.root = pane([member]); return validate(next, kind); }
    const target = leaves(next.root).find(p => p.id === targetId);
    if (!target) throw new Error('The target pane is no longer available.');
    next.root = mapNode(next.root, p => {
      if (p.id !== targetId) return p;
      if (zone === 'centre') { p.memberIds.push(member); p.activeId = member; return p; }
      const added = pane([member]), before = ['left', 'above'].includes(zone);
      return { type: 'split', id: id(), axis: ['left', 'right'].includes(zone) ? 'row' : 'column', ratio: 0.5, first: before ? added : p, second: before ? p : added };
    });
    return validate(next, kind);
  }

  function activate(model, member) {
    const next = copy(model), p = find(next, member);
    if (p) p.activeId = member;
    return next;
  }
  function moveOut(model, member) {
    validate(model, 'terminal');
    if (!find(model, member)) return copy(model);
    const next = remove(model, member); next.standaloneIds.push(member);
    return validate(next, 'terminal');
  }
  function reorder(model, member, target, after) {
    if (member === target) return copy(model);
    const next = remove(model, member), p = find(next, target);
    const list = p?.memberIds || (next.standaloneIds.includes(target) ? next.standaloneIds : null);
    if (!list) return copy(model);
    list.splice(list.indexOf(target) + Number(Boolean(after)), 0, member);
    if (p) p.activeId = member;
    return validate(next);
  }
  function resize(model, splitId, ratio) {
    const next = copy(model);
    function walk(n) {
      if (!n || n.type === 'pane') return;
      if (n.type === 'grid') { n.cells.forEach(c => walk(c.node)); return; }
      if (n.id === splitId) n.ratio = Math.max(0.05, Math.min(0.95, ratio));
      walk(n.first); walk(n.second);
    }
    walk(next.root); return validate(next);
  }

  function migrate(kind, keys, rectangles = [{ x: 0, y: 0, width: 1, height: 1 }]) {
    const result = empty(kind);
    if (!keys.length) return result;
    const cells = rectangles.map((rect, i) => ({ ...rect, node: i < keys.length ? pane([keys[i]]) : null }));
    if (keys.length > cells.length) cells[cells.length - 1].node.memberIds.push(...keys.slice(cells.length));
    function build(items, bounds = { x: 0, y: 0, width: 1, height: 1 }) {
      if (items.length === 1) return items[0].node;
      for (const axis of ['row', 'column']) {
        const coord = axis === 'row' ? 'x' : 'y', size = axis === 'row' ? 'width' : 'height';
        const cuts = [...new Set(items.map(c => c[coord] + c[size]))].sort((a, b) => a - b);
        for (const cut of cuts) {
          const first = items.filter(c => c[coord] + c[size] <= cut + 1e-8), second = items.filter(c => c[coord] >= cut - 1e-8);
          if (!first.length || !second.length || first.length + second.length !== items.length || near(cut, bounds[coord]) || near(cut, bounds[coord] + bounds[size])) continue;
          const a = { ...bounds, [size]: cut - bounds[coord] }, b = { ...bounds, [coord]: cut, [size]: bounds[coord] + bounds[size] - cut };
          const one = build(first, a), two = build(second, b);
          return one && two ? { type: 'split', id: id(), axis, ratio: a[size] / bounds[size], first: one, second: two } : one || two;
        }
      }
      return { type: 'grid', cells: items.filter(c => c.node).map(c => ({ x: (c.x - bounds.x) / bounds.width, y: (c.y - bounds.y) / bounds.height, width: c.width / bounds.width, height: c.height / bounds.height, node: c.node })) };
    }
    result.root = build(cells);
    return validate(result, kind);
  }
  function reconcile(model, keys) {
    const allowed = new Set(keys); let next = copy(model);
    for (const key of members(next)) if (!allowed.has(key)) next = remove(next, key);
    const present = new Set(members(next));
    for (const key of keys) if (!present.has(key)) {
      if (!next.root) next.root = pane([key]);
      else { const p = leaves(next.root).at(-1); p.memberIds.push(key); }
    }
    return validate(next);
  }
  return { empty, pane, copy, validate, leaves, find, members, remove, geometry, order, dock, activate, moveOut, reorder, resize, migrate, reconcile };
});
