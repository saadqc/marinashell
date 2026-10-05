const assert = require('assert/strict');
const M = require('../renderer/services/dockingModel');
const { normalizeProject } = require('../main/services/projects');
const three = [{ x: 0, y: 0, width: .5, height: .5 }, { x: .5, y: 0, width: .5, height: 1 }, { x: 0, y: .5, width: .5, height: .5 }];
let layout = M.migrate('terminal', ['backend', 'worker', 'frontend'], three);
assert.deepEqual(M.order(layout), ['backend', 'worker', 'frontend']);
const original = M.copy(layout);
const backendPane = M.find(layout, 'backend').id;
layout = M.dock(layout, 'worker', backendPane, 'centre');
assert.deepEqual(M.find(layout, 'backend').memberIds, ['backend', 'worker']);
assert.equal(M.find(layout, 'worker').activeId, 'worker');
assert.equal(M.geometry(layout).panes.length, 2);
assert.equal(M.geometry(original).panes.length, 3);
for (const zone of ['left', 'right', 'above', 'below']) {
  const next = M.dock(layout, 'worker', backendPane, zone);
  const a = M.geometry(next).panes.find(p => p.pane.memberIds.includes('backend'));
  const b = M.geometry(next).panes.find(p => p.pane.memberIds.includes('worker'));
  assert(zone === 'left' ? b.x < a.x : zone === 'right' ? b.x > a.x : zone === 'above' ? b.y < a.y : b.y > a.y);
  assert.equal(M.members(next).length, 3); M.validate(next);
}
assert.deepEqual(M.dock(layout, 'worker', backendPane, 'centre'), layout);
const single = M.migrate('terminal', ['one']);
assert.deepEqual(M.dock(single, 'one', single.root.id, 'right'), single);
let detached = M.moveOut(layout, 'worker');
assert.deepEqual(detached.standaloneIds, ['worker']);
assert.deepEqual(M.find(detached, 'backend').memberIds, ['backend']);
assert.deepEqual(M.order(detached), ['backend', 'frontend', 'worker']);
for (const key of ['backend', 'frontend']) detached = M.moveOut(detached, key);
assert.equal(detached.root, null); assert.equal(M.members(detached).length, 3);
detached = M.dock(detached, 'worker', '', 'centre');
assert.equal(M.geometry(detached).panes.length, 1);
assert.deepEqual(detached.standaloneIds, ['backend', 'frontend']);
detached = M.dock(detached, 'backend', M.find(detached, 'worker').id, 'left');
assert.deepEqual(M.order(detached), ['backend', 'worker', 'frontend']);
const split = detached.root;
assert.equal(M.resize(detached, split.id, .7).root.ratio, .7);
assert.equal(M.remove(detached, 'backend').root.type, 'pane', 'Closing preserves the remaining nested subtree');
const restored = M.reconcile(detached, ['worker', 'frontend', 'new']);
assert(!M.members(restored).includes('backend')); assert(M.members(restored).includes('new'));
assert.equal(M.members(restored).length, new Set(M.members(restored)).size);
assert.throws(() => M.dock(single, 'run-output', single.root.id, 'centre', 'configuration'), /Invalid docking/);
assert.throws(() => M.validate({ ...single, standaloneIds: ['one'] }), /duplicate/);
assert.throws(() => M.validate({ ...single, root: { ...single.root, activeId: 'missing' } }), /Invalid docking pane/);
assert.throws(() => M.validate({ ...detached, root: { ...detached.root, id: detached.root.first.id } }), /duplicate docking node/);
assert.throws(() => M.reconcile(single, Array.from({ length: 33 }, (_, i) => `terminal-${i}`)), /32 sessions/);
assert.throws(() => M.moveOut(M.migrate('configuration', ['run']), 'run'), /Invalid docking/);
const pinwheel = [{x:0,y:0,width:.66,height:.33},{x:.66,y:0,width:.34,height:.66},{x:.33,y:.66,width:.67,height:.34},{x:0,y:.33,width:.33,height:.67},{x:.33,y:.33,width:.33,height:.33}];
const legacy = M.migrate('terminal', ['a','b','c','d','e'], pinwheel);
assert.equal(legacy.root.type, 'grid');
assert.deepEqual(M.geometry(legacy).panes.map(({pane,...rect})=>rect).sort((a,b)=>a.y-b.y||a.x-b.x), [...pinwheel].sort((a,b)=>a.y-b.y||a.x-b.x));
const saved = normalizeProject({ name: 'Project', layout: '3-left', dockLayout: detached,
  tabs: ['backend','worker','frontend'].map(key => ({sessionKey:key,manualTitle:key,host:'__local__',currentPath:'/tmp'})) });
assert.deepEqual(saved.dockLayout, detached);
assert.throws(() => normalizeProject({...saved,tabs:saved.tabs.slice(1)}), /missing terminal/);
// Repeated moves exercise collapse/grouping and membership ownership together.
let sequence = original;
for (let i=0;i<80;i++) {
  const keys=['backend','worker','frontend']; const source=keys[i%3], target=keys[(i+1)%3];
  if (i%5===0) sequence=M.moveOut(sequence,source);
  else sequence=M.dock(sequence,source,M.find(sequence,target)?.id||M.leaves(sequence.root)[0]?.id||'', ['centre','left','above'][i%3]);
  M.validate(sequence); assert.deepEqual(new Set(M.members(sequence)),new Set(keys));
}
console.log('PASS: grouping, four edge moves, collapse, Move Out/redock, ordering, resize, membership validation, legacy geometry, stable saved keys');
