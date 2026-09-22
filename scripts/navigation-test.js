// Exercise the real shell in an isolated Electron profile with an instrumented plugin.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { DEFAULT_SETTINGS } = require('../main/constants');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-navigation-'));
app.setPath('userData', root);
const fixture = path.join(root, 'navigation-fixture.mjs');
fs.writeFileSync(fixture, `export default function activate(context) {
  window.fixture = { mounts: 0, disposals: 0, commands: 0, dock: context.dockLayout, state: context.state, sessions: context.sessionTabs };
  context.registerView('editor', {title:'Editor',requiresConnection:false,mount(container){container.textContent='Editor fixture';}});
  context.registerCommand('Fixture command', () => window.fixture.commands++);
  context.registerTab('fixture', 'Fixture', panel => { panel.textContent = 'Sidebar plugin'; });
  context.registerView('fixture', { title: 'Fixture', requiresConnection: false, mount(container) {
    window.fixture.mounts++;
    const input = document.createElement('input'); input.id = 'fixture-draft'; input.value = 'Draft'; container.append(input);
    return () => { window.fixture.disposals++; container.replaceChildren(); };
  }});
  context.registerView('remote-only', { title: 'Remote', supports: ['ssh'], mount() {} });
}`);
let state = { tabs: [{ id: 'one', host: '__local__', manualTitle: 'Local work' }], activeTabId: 'one', tabGroups: [{id:'startup-orphan', name:'Old group'}] };
const settings = structuredClone(DEFAULT_SETTINGS); settings.ui.session.restoreTabs.value = true;
let settingsOpened = 0;
let failConnection = true; let library = []; let tunnelProfiles = []; let externalLinks = []; const connections = []; const writes = []; const processStops=[]; const logRequests=[];
const { normalizeProject } = require('../main/services/projects');
const routes = {
  'app:get-state': () => state, 'app:update-state': patch => (state = { ...state, ...patch }),
  'settings:get': () => settings, 'settings:open': () => { settingsOpened++; },
  'ssh:hosts': () => [{alias:'backend-host'},{alias:'worker-host'}], 'ssh:connect': payload => { connections.push(payload); return failConnection ? ({ ok: false, error: 'Fixture connection unavailable' }) : ({ ok: true }); }, 'ssh:disconnect': () => ({ ok: true }),
  'plugin:processes:list': () => ({ok:true,platform:'Fixture',sampledAt:Date.now()/1000,notes:[],processes:[{pid:1,name:'backend',user:'demo',cpuPercent:12,ramBytes:2048,readBytes:100,writeBytes:100,ports:[8080],identity:'one'},{pid:2,name:'worker',user:'demo',cpuPercent:5,ramBytes:4096,readBytes:null,writeBytes:null,ports:[9000],identity:'two'}]}),
  'plugin:processes:stop': payload => {processStops.push(payload);return {ok:true};},
  'logs:open': payload=>{logRequests.push(payload);return {ok:true};},
  'clipboard:read': () => '',
  'sftp:list': () => [{name:"app's log.txt",path:"/srv/app's log.txt",type:'-',size:20}], 'local:list': () => [{name:"app's log.txt",path:"/srv/app's log.txt",type:'-',size:20}],
  'plugins:list': () => [{ id: 'fixture', name: 'Navigation fixture', enabled: true, rendererEntry: pathToFileURL(fixture).href }, {id:'tunnels',name:'Tunnels',enabled:true,rendererEntry:pathToFileURL(path.resolve('plugins/tunnels/renderer.js')).href}, {id:'processes',name:'Processes',enabled:true,rendererEntry:pathToFileURL(path.resolve('plugins/processes/renderer.js')).href}],
  'plugin:tunnels:list': () => ({ok:true,data:tunnelProfiles}), 'plugin:tunnels:save': profile => { tunnelProfiles=[{...require('../plugins/tunnels/manager').normalize(profile),id:'tunnel-fixture',status:'stopped'}]; return {ok:true}; }, 'plugin:tunnels:start': () => { tunnelProfiles[0].status='active'; return {ok:true}; }, 'plugin:tunnels:stop': () => {tunnelProfiles[0].status='stopped';return {ok:true};},
  'groups:list': () => library, 'groups:save': item => { const saved = { ...normalizeProject(item), id: item.id || 'saved-project' }; library = [saved]; return saved; }, 'groups:delete': id => { library = library.filter(item=>item.id!==id); }, 'shell:open-external': payload => { externalLinks.push(payload); return true; }
};
for (const [channel, handler] of Object.entries(routes)) ipcMain.handle(channel, (_event, payload) => handler(payload));
ipcMain.on('ssh:write', (_event,payload) => { writes.push(payload); }); ipcMain.on('ssh:resize', () => {});
let window;
let cleanupSettings;
require('../main/services/groupCleanup').registerGroupCleanup(ipcMain, () => window);
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { preload: path.resolve('preload.js'), contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await window.loadFile(path.resolve('index.html'));
  const run = async source => { try { return await window.webContents.executeJavaScript(`(async () => { ${source} })()`, true); } catch(error) { console.error(source); console.error(errors); throw error; } };
  await run(`window.waitFor = async fn => { for (let i=0; i<100; i++) { if(fn()) return; await new Promise(r=>setTimeout(r,25)); } throw new Error('Timed out: '+fn); }; await waitFor(()=>window.fixture);`);
  assert.deepEqual(state.tabGroups, [], 'Startup removes groups without restored members');
  // New-session state explains the next action and remote tools are gated.
  assert.equal(await run(`return document.querySelector('[data-view="remote-only"]').disabled`), true);
  await run(`document.querySelector('.welcome-connect').click(); await waitFor(()=>document.querySelector('.welcome-detail.error'));`);
  assert.equal(await run(`return document.querySelector('.welcome-detail.error').textContent`), 'Fixture connection unavailable');
  assert.equal(await run(`return document.querySelector('.welcome-connect').disabled`), false);
  failConnection = false;
  await run(`document.querySelector('.welcome-connect').click(); await waitFor(()=>document.querySelector('.terminal-welcome').hidden);`);
  assert.equal(await run(`return document.querySelector('#connect-btn').textContent`), 'Disconnect');
  assert.equal(await run(`return document.querySelector('#files-connect-btn')`),null);
  assert.equal(await run(`return document.querySelector('.welcome-connect').textContent`),'Reconnect');
  const countBeforeReconnect=await run(`return fixture.state.tabs.size`);
  await run(`window.reconnectTab=fixture.sessions.createTabState({host:'backend-host',currentPath:'/srv/backend',manualTitle:'Reconnect test'});fixture.sessions.setActiveSessionTab(reconnectTab.id);await fixture.sessions.connectTab(reconnectTab,'backend-host',{restorePath:'/srv/backend'});`);
  const reconnectId=await run(`return reconnectTab.id`);
  window.webContents.send('ssh:exit',{tabId:reconnectId});
  await run(`await waitFor(()=>!reconnectTab.welcome.hidden); document.querySelector('#host-select').value='__local__';reconnectTab.welcome.querySelector('.welcome-connect').click();await waitFor(()=>reconnectTab.connected);`);
  assert.deepEqual(connections.at(-1),{tabId:reconnectId,host:'backend-host'});
  assert.equal(await run(`return fixture.state.tabs.size`),countBeforeReconnect+1);
  assert(writes.some(w=>w.tabId===reconnectId && w.data.includes('/srv/backend')));
  await run(`await fixture.sessions.closeTab(reconnectTab.id,{approved:true});`);
  // Runtime-registered sidebar panels can switch back to built-in panels correctly.
  await run(`document.querySelector('[data-tab="fixture"]').click(); document.querySelector('[data-tab="files"]').click();`);
  assert.deepEqual(await run(`return [...document.querySelectorAll('.tab-panel.active')].map(el=>el.id)`), ['tab-files']);
  // Tool state persists across navigation, and selecting it twice is a no-op.
  await run(`document.querySelector('[data-view="fixture"]').click(); document.querySelector('#fixture-draft').value='Keep this draft'; document.querySelector('[data-view="fixture"]').click();`);
  assert.equal(await run(`return fixture.mounts`), 1);
  await run(`document.querySelector('[data-view="terminal"]').click(); document.querySelector('[data-view="fixture"]').click();`);
  assert.equal(await run(`return document.querySelector('#fixture-draft').value`), 'Keep this draft');
  assert.equal(await run(`return fixture.disposals`), 0);
  // Keyboard search runs real registered commands and restores focus on escape.
  await run(`document.querySelector('#command-search').focus(); document.querySelector('#command-search').click(); const input=document.querySelector('.command-palette input'); input.value='Fixture command'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  assert.equal(await run(`return fixture.commands`), 1);
  await run(`document.querySelector('#command-search').click(); const input=document.querySelector('.command-palette input'); input.value='no-such-command'; input.dispatchEvent(new Event('input'));`);
  assert.equal(await run(`return document.querySelector('.command-empty').textContent.startsWith('No matching')`), true);
  await run(`document.querySelector('.command-palette').dispatchEvent(new Event('cancel',{cancelable:true}));`);
  assert.equal(await run(`return document.activeElement.id`), 'command-search');
  await run(`document.querySelector('#extensions-btn').click(); await waitFor(()=>document.querySelector('.extension-row'));`);
  assert.equal(await run(`return [...document.querySelectorAll('.extension-status')].every(el=>el.textContent==='Enabled')`), true);
  await run(`document.querySelector('.extensions-dialog').dispatchEvent(new Event('cancel',{cancelable:true})); document.querySelector('#settings-btn').click();`);
  assert.equal(settingsOpened, 1);
  // Nested split: closing the root's leaf retains its sibling split and both panes.
  await run(`fixture.dock.splitVertical(); fixture.dock.mountViewInActive('terminal'); fixture.dock.splitHorizontal();`);
  assert.equal(await run(`return document.querySelectorAll('.dock-leaf').length`), 3);
  await run(`document.querySelector('.dock-leaf [data-action="close"]').click();`);
  assert.equal(await run(`return document.querySelectorAll('.dock-leaf').length`), 2);
  assert.equal(await run(`return document.querySelectorAll('#dock-root > .dock-split').length`), 1);
  assert.equal(await run(`return fixture.disposals`), 1);
  await run(`fixture.dock.resetLayout();`);
  // Responsive geometry: every connection control stays inside the sidebar.
  for (const width of [1200, 760]) {
    window.setSize(width, 720); await new Promise(r=>setTimeout(r,150));
    assert.equal(await run(`const sidebar=document.querySelector('#sidebar').getBoundingClientRect(); return ['#path-input'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect(); return r.left>=sidebar.left && r.right<=sidebar.right;});`), true);
    assert.equal(await run(`return document.documentElement.scrollWidth === innerWidth`), true);
  }
  await run(`const prototype=fixture.state.tabs.values().next().value.term.constructor.prototype; const original=prototype.registerLinkProvider; prototype.registerLinkProvider=function(provider){this.testProvider=provider; return original.call(this,provider);};`);
  await run(`document.querySelector('[data-view="tunnels"]').click(); await waitFor(()=>document.querySelector('.tunnel-empty')); [...document.querySelectorAll('.tunnel-toolbar button')].find(b=>b.textContent==='New profile').click(); const fields=document.querySelectorAll('dialog[open] input'); fields[0].value='Database'; fields[1].value='5433'; fields[3].value='5432'; [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save profile').click(); await waitFor(()=>document.querySelector('.tunnel-profile')); [...document.querySelectorAll('.tunnel-profile button')].find(b=>b.textContent==='Start').click(); await waitFor(()=>document.querySelector('.tunnel-state.active')); [...document.querySelectorAll('.tunnel-profile button')].find(b=>b.textContent==='Stop').click(); await waitFor(()=>document.querySelector('.tunnel-state.stopped')); document.querySelector('[data-view="terminal"]').click();`);
  assert.equal(tunnelProfiles[0].host,'backend-host');
  // Build and reopen a mixed-host project through the real project editor.
  await run(`document.querySelector('#new-project-btn').click(); document.querySelector('#project-name').value='Product'; document.querySelector('#project-layout').value='2x2'; [...document.querySelectorAll('.project-entry')].forEach((row,i)=>{row.querySelectorAll('input')[1].value=['/srv/backend','/srv/frontend','/srv/worker','/srv/docs'][i]; row.querySelector('select').value=['backend-host','__local__','worker-host','__local__'][i];}); [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save and open').click(); await waitFor(()=>fixture.state.tabs.size===5 && [...fixture.state.tabs.values()].filter(t=>t.groupId).every(t=>t.connected));`);
  assert.equal(library[0].layout,'2x2');
  assert.deepEqual(library[0].tabs.map(t=>t.host),['backend-host','__local__','worker-host','__local__']);
  assert.equal(await run(`return document.querySelectorAll('#session-tabs .session-tab').length`),4);
  assert.equal(await run(`return [...fixture.state.tabs.values()].filter(t=>t.groupId).every(t=>t.currentPath.startsWith('/srv/'))`),true);
  assert.equal(await run(`return document.querySelectorAll('#terminal-stack .terminal-pane.grid-visible').length`),4);
  await run(`document.querySelector('.project-switch[data-project-id=""]').click();`);
  assert.equal(await run(`return document.querySelectorAll('#session-tabs .session-tab').length`),1);
  await run(`document.querySelector('.project-switch:not([data-project-id=""])').click(); document.querySelector('#project-options-btn').click(); [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Close project').click(); await waitFor(()=>fixture.state.tabs.size===1); document.querySelector('#open-project-btn').click(); await waitFor(()=>document.querySelector('.project-library .workspace-library-row')); [...document.querySelectorAll('.project-library button')].find(b=>b.textContent==='Open').click(); await waitFor(()=>fixture.state.tabs.size===5 && [...fixture.state.tabs.values()].filter(t=>t.groupId).every(t=>t.connected));`);
  assert.equal(await run(`return fixture.state.appState.tabGroups.find(g=>g.savedGroupId==='saved-project').layout`),'2x2');
  await run(`document.querySelector('#open-project-btn').click(); await waitFor(()=>document.querySelector('.project-library .workspace-library-row')); [...document.querySelectorAll('.project-library button')].find(b=>b.textContent==='Open').click(); await waitFor(()=>!document.querySelector('.project-library'));`);
  assert.equal(await run(`return fixture.state.tabs.size`),5);
  // Shortcuts follow the visible project strip and must be captured before xterm.
  const shortcutWrites = writes.length;
  await run(`
    const groupId=fixture.state.tabs.get(fixture.state.activeTabId).groupId;
    window.extraShortcutTabs=Array.from({length:5},(_,i)=>fixture.sessions.createTabState({host:'__local__',groupId,manualTitle:'Shortcut '+i}));
    fixture.sessions.renderSessionTabs();
    window.shortcutIds=[...document.querySelectorAll('#session-tabs .session-tab')].map(el=>el.dataset.tabId);
    window.shortcutMod=navigator.platform.toLowerCase().includes('mac')?{metaKey:true}:{ctrlKey:true};
    window.pressShortcut=(key,extra={})=>{
      const tab=fixture.state.tabs.get(fixture.state.activeTabId);
      const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...shortcutMod,...extra});
      const terminalInput=tab.container.querySelector('.xterm-helper-textarea');
      (terminalInput?.isConnected ? terminalInput : document.activeElement).dispatchEvent(event);
      return event.defaultPrevented;
    };
  `);
  assert.equal(await run(`return shortcutIds.length`),9);
  for(let i=1;i<=9;i++) assert.equal(await run(`return pressShortcut('${i}') && fixture.state.activeTabId===shortcutIds[${i-1}]`),true);
  assert.equal(await run(`return pressShortcut('Tab') && fixture.state.activeTabId===shortcutIds[0]`),true);
  assert.equal(await run(`return pressShortcut('Tab',{shiftKey:true}) && fixture.state.activeTabId===shortcutIds[8]`),true);
  assert.equal(await run(`return pressShortcut('Tab',{metaKey:false,ctrlKey:true}) && fixture.state.activeTabId===shortcutIds[0]`),true);
  assert.equal(await run(`return document.activeElement===fixture.state.tabs.get(fixture.state.activeTabId).container.querySelector('.xterm-helper-textarea')`),true,'Tab switching must focus the target terminal');
  // Electron input events also exercise Chromium's native keyboard dispatch.
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'2',modifiers:[process.platform==='darwin'?'meta':'control']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'2',modifiers:[process.platform==='darwin'?'meta':'control']});
  await run(`await waitFor(()=>fixture.state.activeTabId===shortcutIds[1]);`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['control']});
  await run(`await waitFor(()=>fixture.state.activeTabId===shortcutIds[2]);pressShortcut('1');`);
  assert.equal(await run(`const before=fixture.state.tabs.size; pressShortcut('e'); return fixture.dock.getActiveLeaf().viewId==='editor' && fixture.state.tabs.size===before;`),true);
  assert.equal(await run(`const before=fixture.state.tabs.size; pressShortcut('t'); return fixture.dock.getActiveLeaf().viewId==='terminal' && fixture.state.tabs.size===before;`),true);
  await run(`window.beforeNewTerminal=fixture.state.tabs.size;pressShortcut('t',{altKey:true});`);
  assert.equal(await run(`return fixture.state.tabs.size===beforeNewTerminal+1 && fixture.dock.getActiveLeaf().viewId==='terminal'`),true);
  await run(`await fixture.sessions.closeTab(fixture.state.activeTabId,{approved:true});`);
  assert.equal(writes.length,shortcutWrites,'Navigation shortcuts must not send terminal input');
  await run(`pressShortcut('k');`);
  assert.equal(await run(`return Boolean(document.querySelector('.command-palette'))`),true);
  assert.equal(await run(`const before=fixture.state.activeTabId;pressShortcut('2');return fixture.state.activeTabId===before`),true,'Dialogs must block workspace shortcuts');
  await run(`document.querySelector('.command-palette').dispatchEvent(new Event('cancel',{cancelable:true}));`);
  settings.ui.shortcuts.search.value='mod+shift+p';
  settings.ui.shortcuts.nextTab.value='mod+]';
  settings.ui.shortcuts.tab9.value='';
  await run(`window.dispatchEvent(new Event('focus'));await waitFor(()=>fixture.state.shortcutBindings.search?.key==='p');`);
  assert.equal(await run(`pressShortcut('9');return fixture.state.activeTabId===shortcutIds[0]`),true);
  assert.equal(await run(`pressShortcut('k');return !document.querySelector('.command-palette')`),true);
  assert.equal(await run(`return pressShortcut(']') && fixture.state.activeTabId===shortcutIds[1]`),true);
  assert.equal(await run(`pressShortcut('Tab',{metaKey:false,ctrlKey:true});return fixture.state.activeTabId===shortcutIds[1]`),true,'Custom cycle binding replaces the default');
  await run(`pressShortcut('p',{shiftKey:true});`);
  assert.equal(await run(`return Boolean(document.querySelector('.command-palette'))`),true);
  assert.match(await run(`return document.querySelector('#command-search kbd').textContent`),/Shift P/);
  await run(`document.querySelector('.command-palette').dispatchEvent(new Event('cancel',{cancelable:true}));for(const tab of extraShortcutTabs)await fixture.sessions.closeTab(tab.id,{approved:true});`);
  // Exercise both auto-detected links and explicit OSC8 hyperlinks.
  const result = await run(`const tab=fixture.state.tabs.get(fixture.state.activeTabId); const provider=tab.term.testProvider; tab.term.reset(); await new Promise(resolve=>tab.term.write('https://example.com',resolve)); const links=await new Promise(resolve=>provider.provideLinks(1,resolve)); const modifier=navigator.platform.toLowerCase().includes('mac')?{metaKey:true}:{ctrlKey:true}; window.linkTest={tab,links,modifier}; links[0].activate(new MouseEvent('click',{button:0})); tab.term.options.linkHandler.activate(new MouseEvent('click',{button:0}),'https://example.org'); return links.length;`);
  assert.equal(result,1); await new Promise(r=>setTimeout(r,100)); assert.equal(externalLinks.length,0);
  await run(`linkTest.links[0].activate(new MouseEvent('click',{button:0,...linkTest.modifier})); linkTest.tab.term.options.linkHandler.activate(new MouseEvent('click',{button:0,...linkTest.modifier}),'https://example.org');`);
  await new Promise(r=>setTimeout(r,100)); assert.equal(externalLinks.length,2);
  assert.equal(await run(`return Boolean(document.querySelector('#saved-list') || document.querySelector('#recent-list') || document.querySelector('#tunnels-list'))`),false);
  await run(`window.openedFile=null; window.addEventListener('marinashell:editor:open',event=>{window.openedFile=event.detail;}); const tab=fixture.state.tabs.get(fixture.state.activeTabId); tab.term.reset(); await new Promise(resolve=>tab.term.write('AGENTS.md',resolve)); tab.term.select(0,0,9); tab.container.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:300})); [...document.querySelectorAll('.open button')].find(button=>button.textContent==='Open in editor').click();`);
  assert.match(await run(`return window.openedFile.path`),/AGENTS\.md$/);
  const tabsBeforeTail=await run(`return fixture.state.tabs.size`);
  await run(`document.querySelector('.tree-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:150,clientY:250})); [...document.querySelectorAll('.open button')].find(button=>button.textContent==='Tail last 500 lines').click();`);
  assert.equal(logRequests.length,1);assert.match(logRequests[0].path,/app's log.txt$/);
  assert.equal(await run(`return fixture.state.tabs.size`),tabsBeforeTail);
  await run(`document.querySelector('#command-search').click(); const search=document.querySelector('.command-palette input'); search.value='Show Process List'; search.dispatchEvent(new Event('input')); search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await waitFor(()=>document.querySelectorAll('.process-dialog tbody tr').length===2);`);
  assert.equal(await run(`return document.querySelector('.process-dialog tbody tr td').textContent`),'worker');
  await run(`document.querySelector('.process-action button').click(); await waitFor(()=>!document.querySelector('.process-action button').disabled);`);
  assert.equal(processStops.length,1);assert.equal(processStops[0].force,false);
  await run(`document.querySelector('.process-action button').click(); await waitFor(()=>[...document.querySelectorAll('dialog h2')].some(el=>el.textContent==='Force stop process?')); [...document.querySelectorAll('dialog:last-of-type button')].find(el=>el.textContent==='Cancel').click();`);
  assert.equal(processStops.length,1);
  await run(`document.querySelector('.process-action button').click(); await waitFor(()=>[...document.querySelectorAll('dialog h2')].some(el=>el.textContent==='Force stop process?')); [...document.querySelectorAll('dialog:last-of-type button')].find(el=>el.textContent==='Force stop').click(); await waitFor(()=>!document.querySelector('.process-action button').disabled);`);
  assert.equal(processStops.length,2);assert.equal(processStops[1].force,true);
  assert.equal(processStops[0].identity,processStops[1].identity);

  await run(`const port=document.querySelector('[aria-label="Filter processes by port"]');port.value='8080';port.dispatchEvent(new Event('input'));`);
  assert.equal(await run(`return document.querySelectorAll('.process-dialog tbody tr').length`),1);
  assert.equal(await run(`return document.querySelector('.process-dialog tbody tr td').textContent`),'backend');
  await run(`const name=document.querySelector('[aria-label="Filter processes by name"]'); name.value='absent';name.dispatchEvent(new Event('input'));`);
  assert.equal(await run(`return document.querySelector('.process-dialog tbody').textContent`),'No matching processes.');
  await run(`document.querySelector('.process-dialog').dispatchEvent(new Event('cancel',{cancelable:true}));`);
  // Cleanup uses live tabs with restore disabled, preserving same-name groups and saved projects.
  const savedLibrary = structuredClone(library);
  settings.ui.session.restoreTabs.value = false;
  await run(`fixture.state.appSettings = await api.getSettings();
    const first=fixture.sessions.createTabState({host:'__local__',groupId:'live-a'});
    const second=fixture.sessions.createTabState({host:'__local__',groupId:'live-b'});
    const third=fixture.sessions.createTabState({host:'__local__',groupId:'missing'});
    window.cleanupTabs=[first.id,second.id,third.id];
    fixture.state.appState.tabGroups.push({id:'live-a',name:'Same name',layout:'2x2'}, {id:'live-b',name:'Same name'}, {id:'live-a',name:'Duplicate'}, {id:'orphan',name:'Old group'});
    window.beforeCleanupCount=fixture.state.tabs.size;`);
  cleanupSettings = new BrowserWindow({show:false,webPreferences:{preload:path.resolve('preload.js'),contextIsolation:true,nodeIntegration:false}});
  await cleanupSettings.loadFile(path.resolve('settings.html'));
  await cleanupSettings.webContents.executeJavaScript(`document.querySelector('#cleanup-groups').click()`);
  for (let i=0;i<100;i++) {
    if (await cleanupSettings.webContents.executeJavaScript(`!document.querySelector('#cleanup-groups').disabled`)) break;
    await new Promise(r=>setTimeout(r,25));
  }
  assert.match(await cleanupSettings.webContents.executeJavaScript(`document.querySelector('#cleanup-groups-status').textContent`), /Removed 2 unused group entries and repaired 1 tab references/);
  assert.equal(await run(`return fixture.state.tabs.size === beforeCleanupCount`),true);
  assert.equal(await run(`return fixture.state.tabs.get(cleanupTabs[2]).groupId`),'');
  assert.equal(state.tabGroups.filter(group=>group.name==='Same name').length,2);
  assert.equal(state.tabGroups.find(group=>group.id==='live-a').layout,'2x2');
  assert.deepEqual(state.tabs, []);
  assert.deepEqual(library, savedLibrary);
  await run(`await fixture.sessions.closeTab(cleanupTabs[0],{approved:true});`);
  await run(`await api.getState()`); // Drain persistence before checking disk-state fixture.
  assert(!state.tabGroups.some(group=>group.id==='live-a'), 'Closing last member persists group removal with restore disabled');
  const cleanAgain = await run(`return api.invoke('workspace:cleanup-groups')`);
  assert.deepEqual(cleanAgain,{removed:0,repaired:0});
  assert.deepEqual(errors, []);
  console.log('PASS: startup group cleanup, Settings cleanup with restore disabled, same-name active groups preserved, last-member removal persisted, configurable tab/search shortcuts, native keyboard dispatch, terminal focus, mixed-host project creation/reopen/split restoration, duplicate-open prevention, modifier-click links, tunnel profile UI, command search, focus restoration, settings/extensions, sidebar plugins, connection retry, retained tools, nested splits, responsive controls');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  cleanupSettings?.destroy();
  window?.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
