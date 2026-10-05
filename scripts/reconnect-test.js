// Real PTYs and renderer pointer clicks, with private profiles and libraries.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { pathToFileURL } = require('url');
const { DEFAULT_SETTINGS } = require('../main/constants');
const { createSessionManager } = require('../main/services/sessionManager');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-reconnect-'));
const home = path.join(root, 'home'); fs.mkdirSync(home);
os.homedir = () => home; process.env.HOME = home; delete process.env.ZDOTDIR;
app.setPath('userData', root);
fs.writeFileSync(path.join(home, '.zshrc'), 'PS1="fixture> "\n');
fs.writeFileSync(path.join(home, '.bashrc'), 'PS1="fixture> "\n');
const settings = structuredClone(DEFAULT_SETTINGS); settings.shell.local.command.value = '/bin/zsh'; settings.shell.local.args.value = '-l';
settings.ui.session.restoreTabs.value = true;
let window; let output = ''; const exits = [];
const manager = createSessionManager({ getSettings: () => settings, logDebug: () => {}, sendToRenderer(channel, payload) {
  if (channel === 'ssh:data') output += payload.data;
  if (channel === 'ssh:exit') exits.push(payload);
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
} });
let state = { tabs: [{ id: 'one', host: '__local__', currentPath: home, manualTitle: 'Reconnect fixture' }], activeTabId: 'one' };
const plugin = path.join(root, 'fixture.mjs');
fs.writeFileSync(plugin, 'export default function activate(context){window.fixture={state:context.state,sessions:context.sessionTabs};}');
const routes = {
  'app:get-state': () => state, 'app:update-state': patch => (state = { ...state, ...patch }),
  'settings:get': () => settings, 'ssh:hosts': () => [], 'groups:list': () => [],
  'plugins:list': () => [{ id: 'fixture', name: 'Fixture', enabled: true, rendererEntry: pathToFileURL(plugin).href }],
  'ssh:connect': async ({ tabId }) => { try { await manager.connectLocal(tabId); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } },
  'ssh:disconnect': async ({ tabId }) => { await manager.disconnect(tabId); return { ok: true }; },
  'local:list': () => [], 'sftp:list': () => [], 'clipboard:read': () => '', 'files:is-file': () => false
};
for (const [name, handler] of Object.entries(routes)) ipcMain.handle(name, (_event, payload) => handler(payload));
ipcMain.on('ssh:write', (_event, { tabId, data }) => manager.write(tabId, data));
ipcMain.on('ssh:resize', (_event, { tabId, size }) => manager.resize(tabId, size.cols, size.rows));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = code => window.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
async function wait(predicate, label) { for (let i=0;i<150;i++) { if (await predicate()) return; await delay(30); } throw new Error(`Timed out: ${label}`); }
async function reconnect() {
  const rect = await run(`const el=fixture.state.tabs.get('one').welcome.querySelector('.welcome-connect');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:r.width,height:r.height}`);
  assert(rect.width>0 && rect.height>0,'Reconnect button must be visible');
  delete rect.width; delete rect.height;
  window.webContents.sendInputEvent({ type:'mouseDown',button:'left',clickCount:1,...rect });
  window.webContents.sendInputEvent({ type:'mouseUp',button:'left',clickCount:1,...rect });
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ width:1100,height:800,show:false,webPreferences:{preload:path.resolve('preload.js'),contextIsolation:true,nodeIntegration:false} });
  await window.loadFile(path.resolve('index.html'));
  await wait(() => run('return Boolean(window.fixture?.state.tabs.get("one"))'), 'Renderer ready');
  await run(`fixture.sessions.setActiveSessionTab('one');document.querySelector('[data-view="terminal"]').click();`);
  // A renderer reload/restored tab may show disconnected while its old PTY is
  // still alive. Reconnect replaces it; its asynchronous exit arrives later.
  await manager.connectLocal('one');
  await wait(() => output.includes('fixture>'), 'Original shell startup');
  const old = manager.getSession('one').ptyProcess;
  await reconnect();
  await wait(() => manager.getSession('one').ptyProcess !== old, 'Replacement shell');
  await delay(500);
  manager.write('one', 'printf "REPLACEMENT_IS_LIVE\\n"\r');
  await wait(() => output.includes('REPLACEMENT_IS_LIVE\r\n'), 'Replacement PTY accepts commands');
  assert(!output.includes('bad math expression'),'Zsh startup supports an unset prompt-hook array');
  assert.equal(await run('return fixture.state.tabs.get("one").connected'), true, 'Old shell exit must not mark the replacement disconnected');
  assert.equal(await run('return getComputedStyle(document.querySelector(".terminal-welcome")).display'), 'none', 'Successful Reconnect hides disconnected pane');
  // A genuine exit must still show the disconnected pane and allow reconnect.
  manager.write('one', 'exit\r');
  await wait(() => run('return !fixture.state.tabs.get("one").connected'), 'Genuine exit');
  await reconnect();
  await wait(() => run('return fixture.state.tabs.get("one").connected'), 'Reconnect after genuine exit');
  await delay(300);
  assert.equal(await run('return fixture.state.tabs.get("one").connected'), true);
  // An SSH-style asynchronous SFTP teardown must finish before the next PTY
  // is attached, otherwise the old cleanup can clear the new session.
  let finish; let ending = false;
  manager.getSession('one').sftpClient = { end: () => { ending = true; return new Promise(resolve => { finish = resolve; }); } };
  const closing = manager.disconnect('one');
  await wait(() => ending, 'Asynchronous teardown started');
  const connecting = manager.connectLocal('one');
  await delay(50);
  assert.equal(manager.getSession('one').ptyProcess, null, 'Reconnect must wait for old connection cleanup');
  finish(); await Promise.all([closing, connecting]);
  assert(manager.getSession('one').ptyProcess, 'Replacement is attached after old cleanup');
  fs.writeFileSync(path.join(root,'reconnected.png'),(await window.webContents.capturePage()).toPNG());
  console.log('PASS: actual Reconnect pointer replaces a live PTY, ignores retired exits, hides disconnected pane, reconnects after genuine exit, and waits for asynchronous cleanup');
  console.log('SCREENSHOT',path.join(root,'reconnected.png'));
}).catch(async error => { console.error(error); console.log(await run('return {text:document.body.innerText.slice(-1500),connected:window.fixture?.state.tabs.get("one")?.connected,status:window.fixture?.state.tabs.get("one")?.statusMessage,connecting:window.fixture?.state.tabs.get("one")?.connecting}'));console.log('EXITS',exits);process.exitCode = 1; }).finally(async () => { await manager.disconnectAll(); if (window && !window.isDestroyed()) window.destroy(); app.exit(process.exitCode || 0); });
