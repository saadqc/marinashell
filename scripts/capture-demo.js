// Capture the real UI with synthetic IPC data. Never connects to a host or shell.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DEFAULT_SETTINGS } = require('../main/constants');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marinashell-demo-'));
app.setPath('userData', profile);
const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
settings.ui.session.restoreTabs.value = true;
const redesign = process.argv.includes('--redesign');
const overflow = process.argv.find(arg => arg.startsWith('--overflow='))?.split('=')[1];
if (overflow) settings.ui.session.tabOverflow.value = overflow === 'wrap' ? 'wrap' : 'scroll';
let state = {
  lastHost: 'demo-server', activeTabId: 'demo', sidebarCollapsed: false,
  tabs: [{ id: 'demo', host: 'demo-server', connected: true,
    currentPath: '/srv/demo-app', manualTitle: 'Demo server' }],
  savedLocations: { 'demo-server': ['/srv/demo-app'] },
  recentLocations: { 'demo-server': ['/srv/demo-app'] }
};
if (overflow) {
  for (let i = 1; i <= 15; i++) state.tabs.push({
    id: `demo-${i}`, host: 'demo-server', connected: false,
    currentPath: '/srv/demo-app', manualTitle: `Demo session ${i}`,
    groupId: i > 8 ? 'demo-project' : ''
  });
  state.tabGroups = [{ id: 'demo-project', name: 'Demo project', layout: '2x1' }];
}
if (redesign) {
  state.tabs[0].manualTitle = 'Application';
  state.tabs[0].groupId = 'demo-project';
  state.tabs.push({ id: 'logs', host: 'demo-server', manualTitle: 'Logs', groupId: 'demo-project' },
    { id: 'local', host: '__local__', manualTitle: 'Local shell' });
  state.tabGroups = [{ id: 'demo-project', name: 'Demo project', layout: '1x1' }];
}
const entries = ['src', 'public', 'tests', 'README.md', 'package.json'].map((name, i) => ({
  name, path: `/srv/demo-app/${name}`, type: i < 3 ? 'd' : '-', size: 128
}));
const demoRun = {id:'demo-run',configurationId:'demo-dev',name:'Development server',host:'demo-server',status:'running',instance:1};
const routes = {
  'app:get-state': () => state,
  'app:update-state': patch => (state = { ...state, ...patch }),
  'settings:get': () => settings,
  'ssh:hosts': () => [{ alias: 'demo-server' }],
  'ssh:connect': () => ({ ok: true }),
  'ssh:disconnect': () => ({ ok: true }),
  'sftp:list': () => entries,
  'local:list': () => [],
  'plugins:list': () => redesign ? ['editor', 'docker', 'tmux', 'screenshot', 'run-configurations', 'tunnels', 'processes'].map(id => ({ id, enabled: true, rendererEntry: pathToFileURL(path.resolve(__dirname, `../plugins/${id}/${id === 'editor' ? 'renderer.mjs' : 'renderer.js'}`)).href })) : [],
  'plugin:run-configurations:list': () => ({ ok: true, configurations: [{id:'demo-dev',name:'Development server'}], runs: [demoRun], tmuxAvailable: false }),
  'plugin:run-configurations:status': () => ({ok:true,run:demoRun}),
  'plugin:docker:init': () => ({ ok: false, error: 'Docker is not running on this demonstration host.' }),
  'plugin:tmux:status': () => ({ ok: true, tmux: false, screen: false }),
  'plugin:processes:list': () => ({ok:true,platform:'Linux',sampledAt:Date.now()/1000,notes:['Disk rates need two samples. CPU is reported by ps.'],processes:[['node',412,24.3,310,3000],['python3',508,12.8,220,8000],['postgres',624,4.1,180,5432],['redis-server',719,0.8,32,6379]].map(([name,pid,cpuPercent,ram,port])=>({name,pid,user:'demo',cpuPercent,ramBytes:ram*1048576,readBytes:ram*1024,writeBytes:ram*512,identity:String(pid),ports:[port]}))}),
  'plugin:tunnels:list': () => ({ok:true,data:[]}),
  'groups:list': () => []
};
for (const [channel, handler] of Object.entries(routes)) {
  ipcMain.handle(channel, (_event, payload) => handler(payload));
}
ipcMain.on('ssh:write', () => {});
ipcMain.on('ssh:resize', () => {});

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({
    width: 1200, height: 740, show: false, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await window.loadFile(path.resolve(__dirname, '../index.html'));
  await window.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 100; i++) {
      if (document.body.textContent.includes('Connected to demo-server') &&
          document.querySelector('.tree-row')) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Demo UI did not finish loading');
  })()`);
  window.webContents.send('ssh:data', { tabId: 'demo', data: [
    '\x1b[36mdemo@demo-server\x1b[0m:/srv/demo-app$ ls',
    'public  src  tests  README.md  package.json',
    '',
    '\x1b[36mdemo@demo-server\x1b[0m:/srv/demo-app$ npm test',
    '',
    '> demo-app@1.0.0 test',
    '> node --test',
    '',
    '\x1b[32m✔ serves the home page\x1b[0m',
    '\x1b[32m✔ responds to health checks\x1b[0m',
    '\x1b[32m✔ loads static files\x1b[0m',
    '',
    'Tests: 3 passed, 3 total',
    '',
    '\x1b[36mdemo@demo-server\x1b[0m:/srv/demo-app$ '
  ].join('\r\n') });
  await new Promise(resolve => setTimeout(resolve, 500));
  const output = path.resolve(__dirname, redesign ? '../design/validation/workspace-redesign.png' : overflow ? `../design/validation/demo-${settings.ui.session.tabOverflow.value}.png` : '../docs/images/demo.png');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
  if (redesign) {
    await window.webContents.executeJavaScript(`document.querySelector('#command-search').click()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.resolve(__dirname, '../design/validation/command-search.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('.command-palette').dispatchEvent(new Event('cancel', {cancelable:true}))`);
    await window.webContents.executeJavaScript(`document.querySelector('#command-search').click(); const search=document.querySelector('.command-palette input');search.value='Show Process List';search.dispatchEvent(new Event('input'));search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
    await new Promise(resolve=>setTimeout(resolve,300));
    fs.writeFileSync(path.resolve(__dirname,'../design/validation/process-list.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('.process-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`);
    for (const tool of ['editor', 'docker', 'tunnels']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-view="${tool}"]').click()`);
      await new Promise(resolve => setTimeout(resolve, 200));
      fs.writeFileSync(path.resolve(__dirname, `../design/validation/${tool}-redesign.png`), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript(`document.querySelector('[data-view="terminal"]').click()`);
    for (const [selector,name] of [['#open-connect-btn','connect-dialog'],['#new-project-btn','project-editor']]) {
      await window.webContents.executeJavaScript(`document.querySelector('${selector}').click()`);
      await new Promise(resolve=>setTimeout(resolve,150));
      fs.writeFileSync(path.resolve(__dirname,`../design/validation/${name}.png`),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{cancelable:true}))`);
    }
    await window.webContents.executeJavaScript(`document.querySelector('.project-switch[data-project-id=""]').click()`);
    await new Promise(resolve=>setTimeout(resolve,200));
    fs.writeFileSync(path.resolve(__dirname,'../design/validation/sidebar-disconnected.png'),(await window.webContents.capturePage()).toPNG());
    window.setContentSize(760, 650);
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.resolve(__dirname, '../design/validation/workspace-narrow.png'), (await window.webContents.capturePage()).toPNG());
  }
  console.log('Captured demo screenshot using synthetic data');
  window.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  app.quit();
  fs.rmSync(profile, { recursive: true, force: true });
});
