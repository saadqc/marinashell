const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const { DEFAULT_SETTINGS } = require('../main/constants');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-docking-'));
app.setPath('userData', root);
const appRoot = process.env.MARINASHELL_TEST_APP || path.resolve('.');
const fixture = path.join(root, 'fixture.mjs');
fs.writeFileSync(fixture, 'export default function activate(c){window.fixture={state:c.state,sessions:c.sessionTabs};}');
let state = { activeTabId: 'backend', tabGroups: [{id:'project',name:'Docking',layout:'3-left',configurationIds:['a','b']}], tabs: ['backend','worker','frontend'].map(id => ({id,host:'__local__',manualTitle:id,currentPath:root,groupId:'project',connected:true})) };
const settings = structuredClone(DEFAULT_SETTINGS); settings.ui.session.restoreTabs.value = true;
const configs = ['a','b'].map(id => ({id,name:id==='a'?'Alpha':'Beta',host:'__local__',type:'shell',mode:'commands',target:'echo fixture',cwd:root}));
const runs = new Map(), updates = [], disconnects = [];
let stops = 0, closes = 0, failSave = false, pendingPoll = null, slowPoll = false;
const { normalizeProject } = require('../main/services/projects');
let library = [];
const routes = {
  'app:get-state': () => state,
  'app:update-state': patch => { if (failSave) throw new Error('Fixture disk unavailable'); updates.push(structuredClone(patch)); return state={...state,...patch}; },
  'settings:get': () => settings, 'ssh:hosts': () => [], 'ssh:connect': () => ({ok:true}), 'ssh:disconnect': payload => {disconnects.push(payload);return {ok:true};},
  'local:list': () => [], 'sftp:list': () => [], 'clipboard:read': () => '', 'clipboard:write': () => true,
  'groups:list': () => library, 'groups:save': input => { const saved={...normalizeProject(input),id:input.id||'saved-project'};library=[saved];return saved;},
  'groups:delete': () => true,
  'plugins:list': () => [{id:'fixture',enabled:true,rendererEntry:pathToFileURL(fixture).href},{id:'run-configurations',enabled:true,rendererEntry:pathToFileURL(path.join(appRoot,'plugins/run-configurations/renderer.js')).href}],
  'plugin:run-configurations:list': () => ({ok:true,configurations:configs,runs:[...runs.values()],tmuxAvailable:false}),
  'plugin:run-configurations:start': ({id,groupId}) => {const run={id:`run-${id}`,configurationId:id,name:configs.find(c=>c.id===id).name,host:'__local__',cwd:root,groupId,status:'running',instance:1};runs.set(run.id,run);return {ok:true,run};},
  'plugin:run-configurations:poll': async ({id,offset}) => {
    if(slowPoll&&id==='run-a') {slowPoll=false;return new Promise(resolve=>{pendingPoll=()=>resolve({ok:true,run:runs.get(id),output:'STALE',offset:10,generation:1,hasMore:false});});}
    return {ok:true,run:runs.get(id),output:offset?'':`${id} output\r\n`,offset:10,generation:1,hasMore:false};
  },
  'plugin:run-configurations:status': ({id}) => ({ok:true,run:runs.get(id)}),
  'plugin:run-configurations:stop': ({id}) => {stops++;runs.get(id).status='exited';return {ok:true,run:runs.get(id)};},
  'plugin:run-configurations:close': () => {closes++;return {ok:true};},
  'plugin:run-configurations:restart': ({id}) => {const run={...runs.get(id),id:`${id}-next`,status:'running'};runs.get(id).status='exited';runs.set(run.id,run);return {ok:true,run};}
};
for(const [channel,handler] of Object.entries(routes)) ipcMain.handle(channel,(_event,payload)=>handler(payload));
ipcMain.on('ssh:write',()=>{});ipcMain.on('ssh:resize',()=>{});
let window;
app.whenReady().then(async()=>{
  window=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{preload:path.join(appRoot,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  const errors=[];window.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await window.loadFile(path.join(appRoot,'index.html'));
  const run=async source=>{try{return await window.webContents.executeJavaScript(`(async()=>{${source}})()`,true);}catch(error){console.error('UI step:',source);console.error('Renderer:',errors);console.error(await window.webContents.executeJavaScript("[...document.querySelectorAll('dialog[open]')].map(d=>d.textContent)"));throw error;}};
  const wait=()=>new Promise(r=>setTimeout(r,100));
  await run(`window.waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+fn);};await waitFor(()=>window.fixture&&document.querySelector('#run-toolbar select')?.options.length===2);`);
  const point=async(selector,fx=.5,fy=.5)=>run(`const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden '+${JSON.stringify(selector)});return{x:Math.round(r.left+r.width*${fx}),y:Math.round(r.top+r.height*${fy})};`);
  const mouse=(type,p,extra={})=>window.webContents.sendInputEvent({type,...p,button:'left',...extra});
  async function click(selector){const p=await point(selector);mouse('mouseDown',p,{clickCount:1});mouse('mouseUp',p,{clickCount:1});await wait();}
  async function beginDrag(selector,target,fx=.5,fy=.5){
    const start=await point(selector),end=await point(target,fx,fy);mouse('mouseDown',start,{clickCount:1});
    for(let i=1;i<=8;i++){mouse('mouseMove',{x:Math.round(start.x+(end.x-start.x)*i/8),y:Math.round(start.y+(end.y-start.y)*i/8)},{modifiers:['leftButtonDown']});await new Promise(r=>setTimeout(r,20));}
    await wait();return end;
  }
  async function drop(selector,target,fx=.5,fy=.5){const end=await beginDrag(selector,target,fx,fy);mouse('mouseUp',end,{clickCount:1});await wait();}
  assert.equal(await run(`return Boolean(document.querySelector('.dock-leaf-header .layout-menu'))`),false);
  const initial=await run(`return JSON.stringify(fixture.sessions.getDockLayout('project'))`);
  await run(`window.originalTerms=[...fixture.state.tabs.values()].map(t=>t.term);`);
  let end=await beginDrag('.session-tab[data-tab-id="worker"]','.terminal-pane[data-tab-id="backend"]',.5,.5);
  assert.equal(await run(`return document.querySelectorAll('.terminal-docking .docking-overlay:not([hidden]) [data-anchor]').length`),5);
  assert.equal(await run(`return document.querySelector('.terminal-docking .docking-hint').textContent`),'Group here');
  fs.mkdirSync(path.resolve('design/validation'),{recursive:true});
  fs.writeFileSync(path.resolve('design/validation/docking-anchors.png'),(await window.webContents.capturePage()).toPNG());
  mouse('mouseUp',end,{clickCount:1});await wait();
  assert.equal(await run(`return MarinaDocking.find(fixture.sessions.getDockLayout('project'),'worker').memberIds.length`),2);
  assert.equal(await run(`return document.querySelectorAll('.terminal-docking .docking-pane').length`),2);
  assert.equal(await run(`return [...fixture.state.tabs.values()].every(t=>originalTerms.includes(t.term))`),true);
  assert.equal(disconnects.length,0);
  await click('.terminal-docking .docking-member[data-member-id="backend"]');
  assert.equal(await run(`return fixture.state.activeTabId`),'backend');
  await drop('.session-tab[data-tab-id="worker"]','.terminal-pane[data-tab-id="backend"]',.9,.5);
  assert.equal(await run(`const [a,b]=['backend','worker'].map(k=>fixture.state.tabs.get(k).container.getBoundingClientRect());return b.left>a.left&&Math.abs(a.height-b.height)<1;`),true);
  // Each edge is exercised with native pointer input, retaining the same xterms.
  for (const [zone,fx,fy] of [['left',.05,.5],['right',.95,.5],['above',.5,.05],['below',.5,.95]]) {
    await run(`fixture.sessions.setGroupLayout('project','1x1');fixture.sessions.setActiveSessionTab('backend');`);
    await wait();
    await drop('.session-tab[data-tab-id="worker"]','.terminal-pane[data-tab-id="backend"]',fx,fy);
    assert.equal(await run(`const a=fixture.state.tabs.get('backend').container.getBoundingClientRect(),b=fixture.state.tabs.get('worker').container.getBoundingClientRect();return ${zone==='left'?'b.right<=a.left+1':zone==='right'?'b.left>=a.right-1':zone==='above'?'b.bottom<=a.top+1':'b.top>=a.bottom-1'};`),true,zone);
  }
  // Divider movement updates geometry live, but persists only on release.
  const divider=await point('.terminal-docking .pane-divider');
  const priorRatio=await run(`return fixture.sessions.getDockLayout('project').root.ratio`);
  const dividerSaves=updates.length;
  mouse('mouseDown',divider,{clickCount:1});
  const resized={...divider,y:divider.y+65};mouse('mouseMove',resized,{modifiers:['leftButtonDown']});await wait();
  assert.notEqual(await run(`return fixture.sessions.getDockLayout('project').root.ratio`),priorRatio);
  assert.equal(updates.length,dividerSaves);
  mouse('mouseUp',resized,{clickCount:1});await wait();assert(updates.length>dividerSaves);
  // Escape during an above-edge preview leaves the model and saves unchanged.
  const beforeCancel=await run(`return JSON.stringify(fixture.sessions.getDockLayout('project'))`),saveCount=updates.length;
  end=await beginDrag('.session-tab[data-tab-id="worker"]','.terminal-pane[data-tab-id="backend"]',.5,.05);
  assert.equal(await run(`return document.querySelector('.terminal-docking .docking-hint').textContent`),'Dock above');
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});mouse('mouseUp',end,{clickCount:1});await wait();
  assert.equal(await run(`return JSON.stringify(fixture.sessions.getDockLayout('project'))`),beforeCancel);assert.equal(updates.length,saveCount);
  // Native context-menu Move Out preserves the same connection and PTY object.
  const contextPoint=await point('.terminal-pane[data-tab-id="backend"]');mouse('mouseDown',contextPoint,{button:'right',clickCount:1});mouse('mouseUp',contextPoint,{button:'right',clickCount:1});await wait();
  await run(`const b=[...document.querySelectorAll('.context-menu.open button')].find(b=>b.textContent==='Move Out');if(!b||b.disabled)throw Error('Move Out unavailable');b.dataset.testMove='true';`);
  await click('[data-test-move="true"]');
  assert.deepEqual(await run(`return fixture.sessions.getDockLayout('project').standaloneIds`),['backend']);
  assert.equal(await run(`return fixture.state.activeTabId`),'backend');
  assert.equal(await run(`return document.querySelectorAll('.terminal-docking .docking-pane').length`),1);
  assert.equal(disconnects.length,0);
  await click('.session-tab[data-tab-id="worker"]');
  assert.equal(await run(`return document.querySelectorAll('.terminal-docking .docking-pane').length`),2);
  await drop('.session-tab[data-tab-id="backend"]','.terminal-pane[data-tab-id="worker"]',.1,.5);
  assert.deepEqual(await run(`return fixture.sessions.getDockLayout('project').standaloneIds`),[]);
  // Autosave is independent of launch restoration, and failed writes are visible.
  await run(`await fixture.sessions.savedGroups.save('project',true);`);
  settings.ui.session.restoreTabs.value=false;
  await run(`fixture.state.appSettings=await api.getSettings();fixture.sessions.moveOut('frontend');await new Promise(r=>setTimeout(r,100));`);
  assert.deepEqual(state.tabs,[]);assert(state.projectLayouts['saved-project'].dockLayout.standaloneIds.includes('frontend'));
  failSave=true;await run(`fixture.sessions.moveOut('worker');await waitFor(()=>document.querySelector('.layout-save-state').textContent==='Unsaved · Retry');`);
  failSave=false;await click('.layout-save-state');
  assert(state.projectLayouts['saved-project'].dockLayout.standaloneIds.includes('worker'));
  await run(`await waitFor(()=>document.querySelector('.layout-save-state').hidden);`);
  await run(`window.savedTerminalLayout=JSON.stringify(fixture.sessions.getDockLayout('project'));window.writtenOutputs=[];const original=Terminal.prototype.write;Terminal.prototype.write=function(data,...rest){writtenOutputs.push({id:this.element?.closest('.configuration-output')?.dataset.runId,data});return original.call(this,data,...rest);};`);
  // Configuration buttons show output in their own workspace without terminal tabs.
  await click('.run-play');await run(`await waitFor(()=>document.querySelector('[data-run-id="run-a"] .run-pane-visibility'));`);
  const configurationSaveCount=updates.filter(patch=>Object.hasOwn(patch,'projectLayouts')).length;
  await click('[data-run-id="run-a"] .run-pane-visibility');
  assert.equal(await run(`return fixture.state.workspaceMode`),'configuration');
  assert.equal(await run(`return document.querySelector('[data-run-id="run-a"] .run-pane-visibility').getAttribute('aria-pressed')`),'true');
  assert.equal(await run(`return fixture.state.tabs.size`),3);
  await run(`const select=document.querySelector('#run-toolbar select');select.value='b';select.dispatchEvent(new Event('change'));`);
  await click('.run-play');await run(`await waitFor(()=>document.querySelector('[data-run-id="run-b"] .run-chip'));`);
  await click('[data-run-id="run-b"] .run-chip');
  assert.equal(await run(`return document.querySelectorAll('.configuration-output').length`),2);
  await drop('[data-run-id="run-a"] .run-chip','.configuration-output[data-run-id="run-b"]',.1,.5);
  assert.equal(await run(`return document.querySelectorAll('.configuration-docking .docking-pane').length`),2);
  assert.equal(await run(`return JSON.stringify(fixture.sessions.getDockLayout('project'))`),await run(`return savedTerminalLayout`));
  assert.equal(updates.filter(patch=>Object.hasOwn(patch,'projectLayouts')).length,configurationSaveCount,'Configuration docking does not save terminal layouts');
  const shellFocus=await run(`return fixture.state.activeTabId`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'2',modifiers:[process.platform==='darwin'?'meta':'control']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'2',modifiers:[process.platform==='darwin'?'meta':'control']});await wait();
  assert.equal(await run(`return fixture.state.workspaceMode`),'configuration');
  assert.equal(await run(`return document.querySelector('[data-run-id="run-b"] .run-pane-visibility').classList.contains('focused')`),true);
  assert.equal(await run(`return fixture.state.activeTabId`),shellFocus);
  fs.writeFileSync(path.resolve('design/validation/configuration-docking.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(900,680);await wait();
  await run(`await waitFor(()=>[...document.querySelectorAll('.configuration-output.grid-visible')].every(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('.xterm-screen').getBoundingClientRect();return b.height>0&&b.right<=a.right+1&&b.bottom<=a.bottom+1;}));`);
  fs.writeFileSync(path.resolve('design/validation/configuration-docking-narrow.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(1440,960);await wait();
  await click('[data-workspace-mode="terminal"]');assert.equal(await run(`return document.querySelector('#session-tabs-row').hidden`),false);
  await click('[data-workspace-mode="configuration"]');assert.equal(await run(`return document.querySelectorAll('.configuration-docking .docking-pane').length`),2);
  // Hiding a view while its poll is pending must ignore that response.
  slowPoll=true;for(let i=0;i<30&&!pendingPoll;i++)await wait();assert(pendingPoll);
  await click('[data-run-id="run-a"] .run-pane-visibility');pendingPoll();pendingPoll=null;await wait();
  assert.equal(stops,0);assert.equal(closes,0);assert.equal(runs.get('run-a').status,'running');
  assert.equal(await run(`return writtenOutputs.some(w=>w.data==='STALE')`),false);
  assert.equal(await run(`return document.querySelector('[data-run-id="run-a"] .run-pane-visibility').getAttribute('aria-pressed')`),'false');
  assert.equal(await run(`return fixture.state.tabs.size`),3);
  await click('[data-run-id="run-a"] .run-chip');
  await click('.configuration-output[data-run-id="run-a"] .run-output-bar button:last-child');
  assert.equal(stops,1);assert.equal(await run(`return document.querySelector('[data-run-id="run-a"] .run-pane-visibility').getAttribute('aria-pressed')`),'true');
  await run(`window.restartOutput=document.querySelector('.configuration-output[data-run-id="run-a"] .xterm');`);
  await click('.configuration-output[data-run-id="run-a"] .run-output-bar button:nth-last-child(2)');
  await run(`await waitFor(()=>document.querySelector('[data-run-id="run-a-next"] .run-pane-visibility.shown'));`);
  assert.equal(await run(`return document.querySelector('.configuration-output[data-run-id="run-a-next"] .xterm')===restartOutput`),true,'Restart keeps the existing output terminal and placement');
  assert.equal(await run(`return document.querySelectorAll('.configuration-docking .docking-member[data-member-id="run-a"]').length`),0);
  await click('.configuration-output[data-run-id="run-a-next"] .run-output-bar button:last-child');
  assert.notEqual(initial,await run(`return savedTerminalLayout`));
  // Close/reopen and fresh renderer launches keep stable keys and standalone tabs.
  await click('[data-run-id="run-b"] .run-chip');
  await click('.configuration-output[data-run-id="run-b"] .run-output-bar button:last-child');
  await click('[data-run-id="run-a-next"] .run-pane-visibility');
  await click('[data-run-id="run-b"] .run-pane-visibility');
  assert.equal(await run(`return document.querySelectorAll('.configuration-output').length`),0);
  const durable=state.projectLayouts['saved-project'].dockLayout;
  const durableOrder=require('../renderer/services/dockingModel').order(durable);
  await run(`await fixture.sessions.closeGroup('project');await fixture.sessions.savedGroups.restore((await api.invoke('groups:list'))[0]);`);
  assert.deepEqual(await run(`return MarinaDocking.order(fixture.sessions.getDockLayout(fixture.state.tabs.get(fixture.state.activeTabId).groupId))`),durableOrder);
  assert.deepEqual(await run(`return fixture.sessions.getDockLayout(fixture.state.tabs.get(fixture.state.activeTabId).groupId)`),durable);
  settings.ui.session.restoreTabs.value=true;
  await run(`fixture.state.appSettings=await api.getSettings();fixture.sessions.setActiveSessionTab(fixture.state.activeTabId);await waitFor(()=>document.querySelector('.layout-save-state').hidden);`);
  await wait();assert.equal(state.tabs.filter(t=>t.groupId).length,3);
  await window.loadFile(path.join(appRoot,'index.html'));
  await run(`window.waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Reload timed out');};await waitFor(()=>window.fixture&&fixture.state.workspaceReady);`);
  assert.equal(await run(`return fixture.state.workspaceMode`),'terminal');
  assert.deepEqual(await run(`return MarinaDocking.order(fixture.sessions.getDockLayout(fixture.state.tabs.get(fixture.state.activeTabId).groupId))`),durableOrder);
  assert.equal(await run(`return document.querySelectorAll('.configuration-output').length`),0);
  settings.ui.session.restoreTabs.value=false;
  await window.loadFile(path.join(appRoot,'index.html'));
  await run(`window.waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Reload timed out');};await waitFor(()=>window.fixture&&fixture.state.workspaceReady);`);
  assert.equal(await run(`return [...fixture.state.tabs.values()].some(t=>t.groupId)`),false);
  await run(`await fixture.sessions.savedGroups.restore((await api.invoke('groups:list'))[0]);`);
  assert.deepEqual(await run(`return MarinaDocking.order(fixture.sessions.getDockLayout(fixture.state.tabs.get(fixture.state.activeTabId).groupId))`),durableOrder);
  // Editing saved directories preserves docking and drops removed session keys.
  await run(`document.querySelector('#project-options-btn').click();[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Edit saved setup').click();await waitFor(()=>document.querySelector('#project-layout'));`);
  assert.equal(await run(`return document.querySelector('#project-layout').value`),'custom');
  await run(`const row=[...document.querySelectorAll('.project-entry')].find(row=>row.querySelector('input').value==='frontend');row.querySelector('button').click();[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save project').click();await waitFor(()=>!document.querySelector('.project-editor'));`);
  assert.equal(library[0].tabs.length,2);
  assert.equal(require('../renderer/services/dockingModel').members(library[0].dockLayout).includes('frontend'),false);
  await run(`await fixture.sessions.closeGroup(fixture.state.tabs.get(fixture.state.activeTabId).groupId);await fixture.sessions.savedGroups.restore((await api.invoke('groups:list'))[0]);`);
  assert.deepEqual(new Set(await run(`return MarinaDocking.members(fixture.sessions.getDockLayout(fixture.state.tabs.get(fixture.state.activeTabId).groupId))`)),new Set(['backend','worker']));
  assert.deepEqual(errors,[]);
  console.log('PASS: native five-anchor/four-edge docking, divider resize, cancellation, live Move Out/redock, autosave/retry, independent configuration docking/focus, indicators, stale polls, hide without stopping, close/reopen and fresh renderer restore on/off');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{window?.destroy();fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);});
