const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const { createLibraryStore } = require('../main/services/libraryStore');
const { createRunManager } = require('../plugins/run-configurations/manager');
const { normalize } = require('../plugins/run-configurations/configuration');
const { DEFAULT_SETTINGS } = require('../main/constants');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-workspace-test-'));
const exec = promisify(execFile);
const execute = async (_host, command, options = {}) => {
  if (command === 'printf "%s" "$HOME"') return { stdout: root, stderr: '', exitCode: 0 };
  try { return { ...await exec('/bin/bash', ['-c', command], { timeout: options.timeoutMs === 0 ? 0 : 15000, maxBuffer: 2 * 1024 * 1024 }), exitCode: 0 }; }
  catch (error) { return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: Number(error.code) || 1 }; }
};
const manager = createRunManager({ execute, hostIdentity: async () => 'fixture', root });
const groups = createLibraryStore('groups', root);
const configuration = manager.configs.upsert(normalize({ name: 'Development server', type: 'shell', mode: 'commands', target: 'echo "Server ready"; trap "exit 0" TERM; while :; do sleep 1; done', cwd: root, env: { ENVIRONMENT: 'development' } }));
let state = { lastHost: '__local__', tabGroups: [{ id: 'project', name: 'Workspace', layout: '2x1', configurationIds: [configuration.id] }], tabs: [
  { id: 'one', host: '__local__', manualTitle: 'Frontend', currentPath: root, tabColor: 'blue', groupId: 'project' },
  { id: 'two', host: '__local__', manualTitle: 'Backend', currentPath: root, tabColor: 'green', groupId: 'project' }
], activeTabId: 'one', sidebarCollapsed: false };
let writes = 0;
const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); settings.ui.session.restoreTabs.value = true;
const routes = {
  'app:get-state': () => state, 'app:update-state': patch => (state = { ...state, ...patch }),
  'settings:get': () => settings,
  'settings:update': patch => { Object.assign(settings, patch); fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings)); return settings; }, 'ssh:password-response': () => ({ok:true}), 'ssh:hosts': () => [{ alias: 'test-remote' }],
  'ssh:connect': () => ({ ok: true }), 'ssh:disconnect': () => ({ ok: true }),
  'groups:list': () => groups.read(), 'groups:save': group => groups.upsert(group), 'groups:delete': id => groups.remove(id),
  'plugins:list': () => [{ id: 'run-configurations', enabled: true, rendererEntry: pathToFileURL(path.resolve('plugins/run-configurations/renderer.js')).href }],
  'local:list': () => [], 'sftp:list': () => [], 'clipboard:write': () => ({ ok: true }), 'clipboard:read': () => 'do not execute',
  'plugin:run-configurations:group-defaults-get': () => ({ ok: true, defaults: {} }),
  'plugin:run-configurations:list': () => ({ ok: true, configurations: manager.configs.read(), runs: manager.list(), tmuxAvailable: false }),
  'plugin:run-configurations:save': ({ configuration }) => ({ ok: true, configuration: manager.configs.upsert(normalize(configuration)) }),
  'plugin:run-configurations:start': async ({ id, groupId, groupName }) => ({ ok: true, run: await manager.start(id, groupId, groupName) }),
  'plugin:run-configurations:poll': async ({ id, offset, generation }) => ({ ok: true, ...await manager.poll(id, offset, generation) }),
  'plugin:run-configurations:stop': async ({ id, force }) => ({ ok: true, run: await manager.stop(id, force) }),
  'plugin:run-configurations:restart': async ({ id }) => ({ ok: true, run: await manager.restart(id) }),
  'plugin:run-configurations:close': async ({ id }) => { await manager.close(id); return { ok: true }; },
  'plugin:run-configurations:discover': () => ({ ok: true, runtimes: [{ label: 'Bash', manager: 'system', interpreter: '/bin/bash', environment: '' }], warnings: [], tmuxSessions: [] })
};
for (const [name, handler] of Object.entries(routes)) ipcMain.handle(name, async (_e, payload) => { try { return await handler(payload); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.on('ssh:write', () => writes++); ipcMain.on('ssh:resize', () => {});
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1300, height: 900, show: false, webPreferences: { preload: path.resolve('preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', (_e, level, message) => { if (level >= 3) { errors.push(message); console.error('[renderer]', message); } });
  await window.loadFile(path.resolve('index.html'));
  await window.webContents.executeJavaScript("window.addEventListener('error',e=>console.error(e.error?.stack||e.message))");
  const evaluate = async source => { try { return await window.webContents.executeJavaScript('(async () => { return await (async () => {' + source.replace(/(?<!window\.)testWait\(/g, 'await testWait(') + '\n})() })()', true); } catch (error) { console.error('Failed UI step:', source); console.error(await window.webContents.executeJavaScript("JSON.stringify(['#session-tabs','.session-group','.session-group-tabs','.terminal-pane.active','.terminal-pane.active .xterm-screen','#app','#session-tabs-row','#workspace','#dock-root','#terminal-stack','.run-output','.run-output-terminal','.run-output .xterm-screen','.run-output-bar'].map(s=>({s,rect:document.querySelector(s)?.getBoundingClientRect().toJSON()})))")); console.error(await window.webContents.executeJavaScript("JSON.stringify([...document.querySelectorAll('dialog')].map(d=>({open:d.open,text:d.textContent,rect:d.getBoundingClientRect().toJSON()})))")); throw error; } };
  await evaluate(`window.testWait = async (predicate) => { for (let i=0;i<150;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,50)); } throw new Error('UI timed out: '+predicate); }; window.testClick = text => { const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text && b.getBoundingClientRect().width); if(!el) throw new Error('Button not found: '+text); el.click(); }; testWait(()=>document.querySelector('#run-toolbar select')?.options.length > 0)`);
  assert.equal(await evaluate(`return Boolean(document.querySelector('#commands') || document.querySelector('#upload-file'))`), false);
  assert.equal(await evaluate(`return document.querySelector('#run-toolbar').parentElement.id`), 'sidebar');
  assert.equal(await evaluate(`return document.querySelector('#session-bar').getBoundingClientRect().height`), 0);
  assert.equal(await evaluate(`return Boolean(document.querySelector('.dock-leaf-header .layout-menu'))`), true);
  // Saved projects survive closing and reopen their ordered sessions and splits.
  await evaluate(`document.querySelector('#project-options-btn').click(); testClick('Save current sessions and layout');`);
  for (let i=0;i<30 && !groups.read().length;i++) await new Promise(r=>setTimeout(r,50));
  assert.equal(groups.read()[0].tabs[0].manualTitle, 'Frontend'); assert.equal(groups.read()[0].tabs[1].manualTitle, 'Backend');
  await evaluate(`document.querySelector('#project-options-btn').click(); testClick('Close project'); testWait(()=>!document.querySelector('.project-switch[data-project-id="project"]')); document.querySelector('#open-project-btn').click(); testWait(()=>document.querySelector('.workspace-library-row')); testClick('Open'); testWait(()=>document.querySelectorAll('#session-tabs .session-tab').length===2);`);
  assert.equal(groups.read().length,1); assert(state.tabGroups.some(g=>g.name==='Workspace' && g.layout==='2x1'));
  await evaluate(`document.querySelector('#project-options-btn').click(); testClick('Save current sessions and layout');`);
  await new Promise(r=>setTimeout(r,200)); assert.equal(groups.read().length,1);
  const openGroupCount = await evaluate(`return document.querySelectorAll('.project-switch').length`);
  await evaluate(`document.querySelector('#open-project-btn').click(); testWait(()=>document.querySelector('.workspace-library-row')); testClick('Open'); testWait(()=>!document.querySelector('.project-library'));`);
  assert.equal(await evaluate(`return document.querySelectorAll('.project-switch').length`),openGroupCount);
  state.tabGroups.push({ id: 'stale-empty', name: 'Old empty group', configurationIds: [] });
  // Editor and variables modal, apply, remote tmux gating and screenshot.
  await evaluate(`document.querySelector('[aria-label="Edit configurations"]').click()`);
  await evaluate(`testWait(()=>document.querySelector('.run-config-form input'))`);
  assert.equal(await evaluate(`return document.querySelector('.run-config-form').textContent.includes('Old empty group')`), false);
  window.webContents.send('ssh:password-request', { requestId: 'fixture', hostLabel: 'Test SSH', maxAttempts: 1 });
  await evaluate(`testWait(()=>document.querySelector('#password-modal').open); document.querySelector('#password-cancel').click(); testWait(()=>!document.querySelector('#password-modal').open);`);
  assert.equal(await evaluate(`return document.querySelectorAll('.run-form-tabs [role=tab]').length`),4);
  await evaluate(`document.querySelector('#run-section-environment').click();testClick('Edit variables… (1)');`);
  await evaluate(`testWait(()=>document.querySelector('.run-env-dialog')); document.querySelectorAll('.run-env-row input')[1].value='test'; testClick('OK');`);
  await evaluate(`testClick('Apply')`);
  await evaluate(`testWait(()=>!document.querySelector('.run-error')?.textContent)`);
  await new Promise(r=>setTimeout(r,350));
  fs.mkdirSync(path.resolve('design/validation'), { recursive: true });
  window.show();
  await evaluate(`document.fonts.ready; testWait(()=>document.querySelector('.run-editor[open]'))`);
  await new Promise(r=>setTimeout(r,500));
  fs.writeFileSync(path.resolve('design/validation/run-configurations.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('#run-section-run').click();`);
  await new Promise(r=>setTimeout(r,150));
  fs.writeFileSync(path.resolve('design/validation/run-configurations-general.png'), (await window.webContents.capturePage()).toPNG());
  for(const [width,height] of [[1000,700],[760,650]]) {
    window.setSize(width,height);
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await evaluate(`const dialog=document.querySelector('.run-editor').getBoundingClientRect(); const footer=document.querySelector('.run-editor .workspace-dialog-footer').getBoundingClientRect();const panel=document.querySelector('.run-form-panel:not([hidden])');return dialog.top>=0 && footer.bottom<=innerHeight && panel.scrollWidth<=panel.clientWidth && document.querySelectorAll('.run-form-panel:not([hidden])').length===1;`),true,'Configuration modal must fit without horizontal overflow');
  }
  await evaluate(`document.querySelector('#run-section-launch').click();`);
  await new Promise(r=>setTimeout(r,150));
  fs.writeFileSync(path.resolve('design/validation/run-configurations-small.png'), (await window.webContents.capturePage()).toPNG());
  for (const section of ['environment','launch','projects']) {
    await evaluate(`document.querySelector('#run-section-${section}').click();`);
    assert.equal(await evaluate(`const panel=document.querySelector('.run-form-panel:not([hidden])');return panel.scrollWidth<=panel.clientWidth;`),true,'Every configuration section must fit narrow windows');
  }
  window.setSize(1300,900);

  await evaluate(`testClick('Save')`);
  await evaluate(`testWait(()=>!document.querySelector('.run-editor')); document.querySelector('#run-toolbar [aria-label="Run"]').click();`);
  // Launching stays in the run indicator; the output tab opens on demand.
  await evaluate(`testWait(()=>document.querySelector('.running-configuration'))`);
  await evaluate(`testWait(()=>document.querySelectorAll('.running-configuration').length === 1); document.querySelector('.running-configuration').click();`);
  await evaluate(`testWait(()=>document.querySelector('.run-output-bar')?.textContent.includes('Running'))`);
  assert.equal(manager.list().length, 1);
  // The rendered terminal must fit between the run toolbar and pane bottom,
  // including after the window shrinks (FitAddon must exclude toolbar space).
  for (const [width, height] of [[1300, 900], [1000, 650]]) {
    window.setSize(width, height);
    await evaluate(`testWait(() => {
      const pane = document.querySelector('.run-output');
      const screen = pane.querySelector('.xterm-screen').getBoundingClientRect();
      const bar = pane.querySelector('.run-output-bar').getBoundingClientRect();
      const bounds = pane.getBoundingClientRect();
      return screen.height > 0 && screen.top >= bar.bottom && screen.bottom <= bounds.bottom && screen.right <= bounds.right;
    })`);
  }
  window.setSize(1300, 900);
  const writesBeforeReadonly = writes;
  await evaluate(`const textarea=document.querySelector('.run-output .xterm-helper-textarea'); textarea.focus(); textarea.dispatchEvent(new InputEvent('input',{bubbles:true,data:'touch unsafe'}));`);
  assert.equal(writes, writesBeforeReadonly, 'Readonly run forwarded terminal input');
  await new Promise(r=>setTimeout(r,350));
  fs.writeFileSync(path.resolve('design/validation/run-output.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',metaKey:true,bubbles:true}));`);
  await evaluate(`testWait(()=>[...document.querySelectorAll('dialog h2')].some(e=>e.textContent==='Stop running configurations?')); testClick('Cancel');`);
  assert.equal(manager.list().filter(r=>r.status==='running').length, 1);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',metaKey:true,bubbles:true}));`);
  await evaluate(`testWait(()=>[...document.querySelectorAll('dialog h2')].some(e=>e.textContent==='Stop running configurations?')); testClick('Stop and close');`);
  await evaluate(`testWait(()=>!document.querySelector('.run-output-bar'))`);
  assert.equal(manager.list().length, 0);
  assert.equal(await evaluate(`return document.querySelectorAll('.running-configuration').length`), 0);
  // Exercise xterm's real keydown/keyup listeners: one shortcut must write once
  // and cancel Chromium's default paste action.
  await evaluate(`if(document.querySelector('#disconnect-session-btn').disabled) { document.querySelector('.terminal-pane.active .welcome-local').click(); } testWait(()=>!document.querySelector('#disconnect-session-btn').disabled);`);
  const writesBeforePaste = writes;
  const pasteEvents = await evaluate(`
    const textarea = [...document.querySelectorAll('.xterm-helper-textarea')].find(el=>el.closest('.xterm').getBoundingClientRect().width);
    textarea.focus();
    const modifier = navigator.platform.toLowerCase().includes('mac') ? {metaKey:true} : {ctrlKey:true};
    return ['keydown','keyup'].map(type => {
      const event = new KeyboardEvent(type, {key:'v',code:'KeyV',keyCode:86,bubbles:true,cancelable:true,...modifier});
      textarea.dispatchEvent(event);
      return event.defaultPrevented;
    });
  `);
  await new Promise(r=>setTimeout(r,150));
  assert.deepEqual(pasteEvents, [true, true], 'Paste shortcut did not cancel native paste');
  assert.equal(writes - writesBeforePaste, 1, 'Paste shortcut must forward clipboard exactly once');
  await evaluate(`document.querySelector('#disconnect-session-btn').click(); testWait(()=>document.querySelector('#disconnect-session-btn').disabled);`);
  // Sessions belong above the workspace; the connection sidebar has its own heading.
  await evaluate(`for (let i = 0; i < 14; i++) document.querySelector('#new-tab-btn').click();`);
  await evaluate(`testWait(() => {
    const strip = document.querySelector('#session-tabs');
    const active = strip.querySelector('.session-tab.active').getBoundingClientRect();
    const bounds = strip.getBoundingClientRect();
    return strip.scrollWidth > strip.clientWidth && active.left >= bounds.left && active.right <= bounds.right + 1;
  });`);
  assert.equal(await evaluate(`
    const bar = document.querySelector('#session-tabs-row').getBoundingClientRect();
    const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
    const workspace = document.querySelector('#workspace').getBoundingClientRect();
    const header = document.querySelector('#app-header').getBoundingClientRect();
    return bar.top === header.bottom && bar.left === sidebar.right && bar.right === innerWidth && sidebar.top === header.bottom && workspace.top === bar.bottom;
  `), true);
  assert.equal(await evaluate(`
    const strip = document.querySelector('#session-tabs'); strip.scrollLeft = 0;
    strip.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, bubbles: true, cancelable: true}));
    return strip.scrollLeft > 0;
  `), true);
  const preferences = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('preload.js'), contextIsolation: true, nodeIntegration: false } });
  try {
    await preferences.loadFile(path.resolve('settings.html'));
    assert.equal(await preferences.webContents.executeJavaScript("document.querySelectorAll('main > section.card').length"), 6);
    assert.equal(await preferences.webContents.executeJavaScript("document.querySelectorAll('section.card section.card').length"), 0);
    await preferences.webContents.executeJavaScript(`(async () => {
      for (let i=0; i<100 && !document.querySelector('#session-tab-title-template').value; i++) await new Promise(r=>setTimeout(r,50));
      const select = document.querySelector('#session-tab-overflow');
      select.value = 'wrap'; select.dispatchEvent(new Event('change', {bubbles:true}));
      const shortcut=document.querySelector('#shortcut-search');shortcut.value='mod+shift+p';shortcut.dispatchEvent(new Event('input'));
      const choose=document.querySelector('#shortcut-tab9');choose.value='';choose.dispatchEvent(new Event('input'));
      const next=document.querySelector('#shortcut-nextTab');next.value='ctrl+tab';next.dispatchEvent(new Event('input'));
    })()`);
    for (let i=0; i<100 && settings.ui.session.tabOverflow.value !== 'wrap'; i++) await new Promise(r=>setTimeout(r,50));
    assert.equal(settings.ui.session.tabOverflow.value, 'wrap');
    assert.equal(settings.ui.shortcuts.search.value,'mod+shift+p');
    assert.equal(settings.ui.shortcuts.tab9.value,'');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'settings.json'))).ui.shortcuts.nextTab.value,'ctrl+tab');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))).ui.session.tabOverflow.value, 'wrap');
    await new Promise(resolve => { preferences.webContents.once('did-finish-load', resolve); preferences.reload(); });
    assert.equal(await preferences.webContents.executeJavaScript(`new Promise(resolve => setTimeout(() => resolve(document.querySelector('#session-tab-overflow').value), 200))`), 'wrap');
    assert.equal(await preferences.webContents.executeJavaScript("document.querySelector('#shortcut-search').value"),'mod+shift+p');
    assert.equal(await preferences.webContents.executeJavaScript("document.querySelector('#shortcut-tab9').value"),'');
  } finally { preferences.destroy(); }
  await evaluate(`window.dispatchEvent(new Event('focus')); testWait(()=>document.querySelector('#session-tabs').dataset.overflow === 'wrap');`);
  for (const [width, height] of [[1300, 900], [760, 650]]) {
    window.setSize(width, height);
    await evaluate(`testWait(() => {
      const strip = document.querySelector('#session-tabs');
      const tabs = [...strip.querySelectorAll('.session-tab')].map(t=>t.getBoundingClientRect());
      const pane = document.querySelector('.terminal-pane.active');
      const screen = pane.querySelector('.xterm-screen').getBoundingClientRect();
      const bounds = pane.getBoundingClientRect();
      return new Set(tabs.map(t=>t.top)).size > 1 && strip.scrollWidth <= strip.clientWidth + 1 && screen.width > 0 && screen.right <= bounds.right && screen.bottom <= bounds.bottom;
    });`);
  }
  await evaluate(`document.querySelector('#sidebar-collapse-btn').click(); testWait(()=>document.querySelector('#sidebar').getBoundingClientRect().width === 0);`);
  assert.equal(await evaluate(`return document.querySelector('#workspace').getBoundingClientRect().left === document.querySelector('#activity-rail').getBoundingClientRect().right`), true);
  await evaluate(`document.querySelector('#sidebar-collapse-btn').click();`);
  settings.ui.session.tabOverflow.value = 'scroll';
  await evaluate(`window.dispatchEvent(new Event('focus')); testWait(()=>document.querySelector('#session-tabs').dataset.overflow === 'scroll');`);
  assert.equal(await evaluate(`return [...document.querySelectorAll('#session-tabs, .session-group-tabs')].every(list => new Set([...list.children].map(t=>t.getBoundingClientRect().top)).size <= 1)`), true);
  console.log('PASS: workspace tab bar, wheel scrolling, active-tab visibility, persisted settings, grouped tab wrapping, resizing and sidebar collapse');
  assert.deepEqual(errors.filter(e=>!e.includes('Electron Security Warning')), []);
  console.log('PASS: actual workspace group save/close/restore, configuration editor/env modal, readonly output, close confirmation/cancel/stop, single terminal paste');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await manager.shutdown(); window?.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
