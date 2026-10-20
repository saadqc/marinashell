// Isolate both application instances and their real terminal processes.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { spawn } = require('child_process');
const childMode = process.argv.includes('--handoff-child');
const root = childMode ? process.env.MARINA_HANDOFF_TEST_ROOT : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marina-handoff-')));
os.homedir = () => root; process.env.HOME = root;
app.setPath('userData', path.join(root, 'app-data'));
const first = path.join(root, "First 'quoted' 日本語 $(touch NO_EXECUTION)");
const second = path.join(root, 'Second folder');
if (!childMode) {
  fs.mkdirSync(first); fs.mkdirSync(second);
  const settings = structuredClone(require('../main/constants').DEFAULT_SETTINGS);
  settings.ui.session.restoreTabs.value = true;
  settings.shell.local.command.value = '/bin/bash';
  settings.shell.local.args.value = '--noprofile --norc';
  require('../main/services/settingsStore').saveSettings(settings);
  process.argv.push('--open-directory', first);
}
require('../main/app');
if (!childMode) app.whenReady().then(async () => {
  let window;
  for (let i = 0; i < 150; i++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading()) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(window);
  async function matching(directory, count) {
    for (let i = 0; i < 150; i++) {
      const state = await window.webContents.executeJavaScript('window.api.getState()');
      const tabs = state.tabs.filter(tab => tab.currentPath === directory && tab.host === '__local__' && tab.connected);
      if (tabs.length === count) return tabs;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error('Directory handoff did not create the expected local tabs');
  }
  const [tab] = await matching(first, 1);
  assert(!tab.groupId);
  const encoded = Buffer.from(first + '\n').toString('base64');
  await window.webContents.executeJavaScript(`window.handoffOutput='';window.api.onSshData(({tabId,data})=>{if(tabId===${JSON.stringify(tab.id)})window.handoffOutput+=data});window.api.write(${JSON.stringify(tab.id)},'pwd -P | base64\\n');`);
  let output = '';
  for (let i = 0; i < 100; i++) { output = await window.webContents.executeJavaScript('window.handoffOutput'); if (output.replace(/[\r\n]/g, '').includes(encoded)) break; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert(output.replace(/[\r\n]/g, '').includes(encoded), 'Real PTY must start in the selected directory');
  const launch = directory => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--handoff-child', '--open-directory', directory], { env: { ...process.env, MARINA_HANDOFF_TEST_ROOT: root }, stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Second instance did not exit')); }, 10000);
    child.once('error', reject); child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`)); });
  });
  await launch(second); await matching(second, 1);
  await launch(second); await matching(second, 2);
  if (process.platform === 'darwin') {
    const bootstrap = path.join(root, 'native-bootstrap.cjs');
    fs.writeFileSync(bootstrap, `const {app}=require('electron');require('os').homedir=()=>${JSON.stringify(root)};process.env.HOME=${JSON.stringify(root)};app.setPath('userData',${JSON.stringify(path.join(root, 'app-data'))});require(${JSON.stringify(path.resolve(__dirname, '../main/app'))});`);
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/open', ['-n', '-a', path.resolve(process.execPath, '../../..'), '--args', bootstrap, '--open-directory', second], { stdio: 'ignore' });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Native application launch failed')));
    });
    await matching(second, 3);
  }
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert(!fs.existsSync(path.join(first, 'NO_EXECUTION')));
  const state = await window.webContents.executeJavaScript('window.api.getState()');
  for (const item of state.tabs) await window.webContents.executeJavaScript(`window.api.disconnect(${JSON.stringify(item.id)})`);
  console.log('PASS: actual first/second-instance directory handoff, fresh ungrouped local tabs, real PTY cwd and literal path safety');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
