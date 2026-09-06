// Run the real application with isolated settings/libraries, without touching
// the user's app data or enabling plugins in their installation.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-activation-test-'));
os.homedir = () => root;
app.setPath('userData', root);
require('../main/app');
app.whenReady().then(async () => {
  let window;
  for (let i = 0; i < 100; i++) { window = BrowserWindow.getAllWindows()[0]; if (window && !window.webContents.isLoading()) break; await new Promise(r => setTimeout(r, 50)); }
  const initial = await window.webContents.executeJavaScript('window.api.getPlugins()');
  const run = initial.find(plugin => plugin.id === 'run-configurations');
  assert(run); assert.equal(run.enabled, false); assert.equal(run.loaded, false);
  await window.webContents.executeJavaScript(`(async()=>{ const settings=await window.api.getSettings(); settings.plugins.enabled.list.value=['run-configurations']; await window.api.updateSettings(settings); })()`);
  await new Promise(r => setTimeout(r, 800));
  const enabled = await window.webContents.executeJavaScript('window.api.getPlugins()');
  const active = enabled.find(plugin => plugin.id === 'run-configurations');
  assert.equal(active.enabled, true); assert.equal(active.loaded, true); assert.equal(active.error, null);
  const result = await window.webContents.executeJavaScript(`window.api.invoke('plugin:run-configurations:discover', {host:'__local__',type:'shell'})`);
  assert.equal(result.ok, true, result.error); assert(result.runtimes.some(runtime => runtime.interpreter.includes('bash')));
  const exists = await window.webContents.executeJavaScript('Boolean(document.querySelector("#run-toolbar"))'); assert(exists);
  console.log('PASS: real application defaults plugin off, enables plugin without restart, loads renderer/IPC, discovers local shells');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
