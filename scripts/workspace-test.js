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
  'settings:get': () => settings, 'ssh:password-response': () => ({ok:true}), 'ssh:hosts': () => [{ alias: 'test-remote' }],
  'ssh:connect': () => ({ ok: true }), 'ssh:disconnect': () => ({ ok: true }),
  'groups:list': () => groups.read(), 'groups:save': group => groups.upsert(group), 'groups:delete': id => groups.remove(id),
  'plugins:list': () => [{ id: 'run-configurations', enabled: true, rendererEntry: pathToFileURL(path.resolve('plugins/run-configurations/renderer.js')).href }],
  'local:list': () => [], 'sftp:list': () => [], 'clipboard:write': () => ({ ok: true }), 'clipboard:read': () => 'do not execute',
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
  const evaluate = async source => { try { return await window.webContents.executeJavaScript('(async () => { return await (async () => {' + source.replace(/(?<!window\.)testWait\(/g, 'await testWait(') + '\n})() })()', true); } catch (error) { console.error('Failed UI step:', source); console.error(await window.webContents.executeJavaScript("JSON.stringify([...document.querySelectorAll('dialog')].map(d=>({open:d.open,text:d.textContent,rect:d.getBoundingClientRect().toJSON()})))")); throw error; } };
  await evaluate(`window.testWait = async (predicate) => { for (let i=0;i<150;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,50)); } throw new Error('UI timed out: '+predicate); }; window.testClick = text => { const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text && b.getBoundingClientRect().width); if(!el) throw new Error('Button not found: '+text); el.click(); }; testWait(()=>document.querySelector('#run-toolbar select')?.options.length > 0)`);
  assert.equal(await evaluate(`return Boolean(document.querySelector('#commands') || document.querySelector('#upload-file'))`), false);
  // Independent snapshot survives closing the live group; restoring keeps titles/order/layout.
  await evaluate(`document.querySelector('.session-group-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:250,clientY:50})); testClick('Save group…');`);
  await evaluate(`testWait(()=>document.querySelector('.session-text-dialog.open'))`);
  await evaluate(`document.querySelector('.session-text-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  for (let i=0;i<30 && !groups.read().length;i++) await new Promise(r=>setTimeout(r,50));
  assert.equal(groups.read()[0].tabs[0].manualTitle, 'Frontend'); assert.equal(groups.read()[0].tabs[1].manualTitle, 'Backend');
  await evaluate(`document.querySelector('.session-group-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:250,clientY:50})); testClick('Close group…');`);
  await evaluate(`testWait(()=>!document.querySelector('.session-group'))`);
  await evaluate(`document.querySelector('#saved-groups-btn').click();`);
  await evaluate(`testWait(()=>document.querySelector('.workspace-library-row')); testClick('Restore');`);
  await evaluate(`testWait(()=>document.querySelector('.session-group'))`);
  assert.equal(groups.read().length, 1); assert(state.tabGroups.some(g => g.name === 'Workspace' && g.layout === '2x1'));
  // Editor and variables modal, apply, remote tmux gating and screenshot.
  await evaluate(`testClick('Edit configurations…')`);
  await evaluate(`testWait(()=>document.querySelector('.run-config-form input'))`);
  window.webContents.send('ssh:password-request', { requestId: 'fixture', hostLabel: 'Test SSH', maxAttempts: 1 });
  await evaluate(`testWait(()=>document.querySelector('#password-modal').open); document.querySelector('#password-cancel').click(); testWait(()=>!document.querySelector('#password-modal').open);`);
  await evaluate(`testClick('Edit variables… (1)');`);
  await evaluate(`testWait(()=>document.querySelector('.run-env-dialog')); document.querySelectorAll('.run-env-row input')[1].value='test'; testClick('OK');`);
  await evaluate(`testClick('Apply')`);
  await evaluate(`testWait(()=>!document.querySelector('.run-error')?.textContent)`);
  await new Promise(r=>setTimeout(r,350));
  fs.mkdirSync(path.resolve('design/validation'), { recursive: true });
  fs.writeFileSync(path.resolve('design/validation/run-configurations.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`testClick('Save')`);
  await evaluate(`testWait(()=>!document.querySelector('.run-editor')); document.querySelector('#run-toolbar [aria-label="Run"]').click();`);
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
  await evaluate(`const textarea=document.querySelector('.run-output .xterm-helper-textarea'); textarea.focus(); textarea.dispatchEvent(new InputEvent('input',{bubbles:true,data:'touch unsafe'}));`);
  assert.equal(writes, 0, 'Readonly run forwarded terminal input');
  await new Promise(r=>setTimeout(r,350));
  fs.writeFileSync(path.resolve('design/validation/run-output.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',metaKey:true,bubbles:true}));`);
  await evaluate(`testWait(()=>[...document.querySelectorAll('dialog h2')].some(e=>e.textContent==='Stop running configurations?')); testClick('Cancel');`);
  assert.equal(manager.list().filter(r=>r.status==='running').length, 1);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',metaKey:true,bubbles:true}));`);
  await evaluate(`testWait(()=>[...document.querySelectorAll('dialog h2')].some(e=>e.textContent==='Stop running configurations?')); testClick('Stop and close');`);
  await evaluate(`testWait(()=>!document.querySelector('.run-output-bar'))`);
  assert.equal(manager.list().length, 0);
  // Exercise xterm's real keydown/keyup listeners: one shortcut must write once
  // and cancel Chromium's default paste action.
  await evaluate(`testClick('Connect'); testWait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Disconnect'));`);
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
  await evaluate(`testClick('Disconnect'); testWait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Connect'));`);
  assert.deepEqual(errors.filter(e=>!e.includes('Electron Security Warning')), []);
  console.log('PASS: actual workspace group save/close/restore, configuration editor/env modal, readonly output, close confirmation/cancel/stop, single terminal paste');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await manager.shutdown(); window?.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
