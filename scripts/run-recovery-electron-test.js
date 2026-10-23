const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { DEFAULT_SETTINGS } = require('../main/constants');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-recovery-ui-'));
app.setPath('userData', root);
const appRoot = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixture.mjs');
fs.writeFileSync(fixture, `import {registerRunAction} from ${JSON.stringify(pathToFileURL(path.join(appRoot, 'renderer/services/debugIntegration.js')).href)};export default function activate(){registerRunAction('fixture-debug',{label:'Debug fixture',icon:'bug',start:async()=>{throw Error('Unexpected debug launch')}});}`);
let state = { activeTabId: 'shell', tabs: [{ id: 'shell', host: '__local__', currentPath: root, sessionType: 'local' }] };
const configuration = { id: 'config', name: 'Backend', host: '__local__', type: 'shell', mode: 'commands', target: 'echo fixture', cwd: root };
let managed = { id: 'run', configurationId: 'config', name: 'Backend', host: '__local__', status: 'unknown', error: 'Run owner cannot be verified.', instance: 1 };
let deferStatus = false, pending = [], launches = 0, stops = 0;
const routes = {
  'app:get-state': () => state, 'app:update-state': patch => state = { ...state, ...patch },
  'settings:get': () => structuredClone(DEFAULT_SETTINGS), 'ssh:hosts': () => [], 'ssh:connect': () => ({ ok: true }),
  'local:list': () => [], 'sftp:list': () => [], 'groups:list': () => [],
  'plugins:list': () => [{ id: 'fixture', enabled: true, rendererEntry: pathToFileURL(fixture).href }, { id: 'run-configurations', enabled: true, rendererEntry: pathToFileURL(path.join(appRoot, 'plugins/run-configurations/renderer.js')).href }],
  'plugin:run-configurations:list': () => ({ ok: true, configurations: [configuration], runs: [managed] }),
  'plugin:run-configurations:status': () => deferStatus ? new Promise(resolve => pending.push(resolve)) : { ok: true, run: managed },
  'plugin:run-configurations:start': () => { launches++; return { ok: true, run: managed }; },
  'plugin:run-configurations:stop': () => { stops++; return { ok: true, run: managed }; }
};
for (const [channel, handler] of Object.entries(routes)) ipcMain.handle(channel, (_event, payload) => handler(payload));
ipcMain.on('ssh:write', () => {}); ipcMain.on('ssh:resize', () => {});
let window;
const delay = () => new Promise(resolve => setTimeout(resolve, 50));
const run = source => window.webContents.executeJavaScript(`(async()=>{${source}})()`, true);
async function wait(source) { for (let i = 0; i < 160; i++) { if (await run(`return Boolean(${source});`)) return; await delay(); } throw Error(`Timed out: ${source}`); }
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { preload: path.join(appRoot, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(path.join(appRoot, 'index.html'));
  await wait(`document.querySelector('.run-debug') && document.querySelector('.run-check-status')?.getBoundingClientRect().height`);
  assert(await run(`return document.querySelector('.run-health').textContent.includes('Status unknown')`));
  assert(await run(`return document.querySelector('.run-debug').disabled && document.querySelector('.run-play').hidden && document.querySelector('[aria-label="Restart"]').disabled && document.querySelector('[aria-label="Stop"]').disabled`));
  assert.equal(await run(`return document.querySelectorAll('.configuration-output').length`), 0, 'Recovery is available without opening output');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(os.tmpdir(), 'marina-run-recovery-unknown.png'), (await window.webContents.capturePage()).toPNG());
  deferStatus = true;
  const point = await run(`const r=document.querySelector('.run-check-status').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await wait(`document.querySelector('.run-check-status').disabled && document.querySelector('.run-check-status').textContent==='Checking…'`);
  assert(pending.length);
  managed = { ...managed, status: 'exited', endReason: 'host-restarted', error: 'Execution host restarted; exit code unavailable.' };
  deferStatus = false; for (const resolve of pending.splice(0)) resolve({ ok: true, run: managed });
  await wait(`!document.querySelector('.run-play').hidden && !document.querySelector('.run-debug').disabled && document.querySelector('.run-check-status').hidden`);
  assert(await run(`return document.querySelector('.run-health').textContent.includes('host restarted')`));
  assert.equal(launches, 0); assert.equal(stops, 0);
  window.setSize(650, 700); await delay();
  assert(await run(`const el=document.querySelector('.run-health');const r=el.getBoundingClientRect();return el.scrollWidth<=el.clientWidth+1 && r.width>0`));
  assert.equal(await run(`return document.querySelector('.run-status').getAttribute('role')`), 'status');
  fs.writeFileSync(path.join(os.tmpdir(), 'marina-run-recovery-complete.png'), (await window.webContents.capturePage()).toPNG());
  console.log('PASS: visible unknown-state explanation, native Check status click without output, pending feedback, restored Run/Debug, reboot reason, narrow layout, no process mutation');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { window?.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0); });
