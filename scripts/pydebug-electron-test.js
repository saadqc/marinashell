// Real application, IPC, CodeMirror and pointer input; private settings/libraries.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-pydebug-ui-'));
const python = process.env.PYDEBUG_TEST_PYTHON || '/tmp/marinashell-pydebug-test-env/bin/python';
const setupEnv = path.join(root, 'setup-env'); const wheels = path.join(root, 'wheels'); fs.mkdirSync(wheels);
execFileSync(python, ['-m', 'venv', setupEnv]);
execFileSync(python, ['-m', 'pip', 'download', '--disable-pip-version-check', '--no-deps', '--dest', wheels, 'debugpy==1.8.17'], { stdio: 'pipe' });
os.homedir = () => root; process.env.HOME = root; app.setPath('userData', root);
const source = path.join(root, 'fixture.py');
fs.writeFileSync(source, 'import time\nnumber = 41\npayload = {"answer": number + 1, "items": [1, 2]}\nnumber += 1\ntime.sleep(30)\n');
fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ tabs: [{ id: 'fixture', host: '__local__', currentPath: root, manualTitle: 'PyDebug fixture', sessionType: 'local' }], activeTabId: 'fixture' }));
require('../main/app');
let window;
let sshFixture;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = code => window.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
async function updatePlugins(code) {
  let timer;
  const reloaded=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Plugin change did not reload renderer')),15000);
    window.webContents.once('did-finish-load',resolve);
  });
  reloaded.catch(()=>{});
  try{await run(code);await reloaded;}finally{clearTimeout(timer);}
}
async function wait(code, label, count = 150) { for (let i = 0; i < count; i++) { if (await run(`return Boolean(${code})`)) return; await delay(100); } throw new Error(`Timed out: ${label}`); }
async function pointer(selector) {
  const rect = await run(`const el=document.querySelector(${JSON.stringify(selector)}); if(!el)throw new Error('Missing pointer target');el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
}
app.whenReady().then(async () => {
  for (let i = 0; i < 100; i++) { window = BrowserWindow.getAllWindows()[0]; if (window && !window.webContents.isLoading()) break; await delay(50); }
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('[renderer]', message); });
  await updatePlugins(`const settings=await api.getSettings(); settings.plugins.enabled.list.value=['run-configurations','pydebug']; await api.updateSettings(settings);`);
  await wait(`document.querySelector('.run-debug')`, 'Debug contribution');
  await wait(`window.marinashellEditorDocuments`, 'Editor renderer ready');
  const config = await run(`return api.invoke('plugin:run-configurations:save',{configuration:{name:'Python UI fixture',host:'__local__',type:'python',mode:'script',interpreter:${JSON.stringify(python)},target:${JSON.stringify(source)},cwd:${JSON.stringify(root)}}})`);
  assert.equal(config.ok, true, config.error);
  await run(`const select=document.querySelector('.run-launcher select');select.value=${JSON.stringify(config.configuration.id)};select.dispatchEvent(new Event('change'));`);
  await pointer('#run-toolbar [aria-label="Edit configurations"]');
  await wait(`document.querySelector('.run-editor[open]')`, 'Configuration editor');
  await pointer('#run-section-environment');
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('debugpy found in current environment')`, 'Selected environment debugger found');
  assert.equal(await run(`return document.querySelector('.run-debugpy-install').hidden`), true);
  await pointer('.run-debugpy-actions button:last-child');
  await wait(`(await api.readClipboard()).includes('debugpy==1.8.17')`, 'Copied install command');
  const copied = await run(`return api.readClipboard()`); assert.match(copied,/debugpy==1\.8\.17/); assert.match(copied,/marinashell-pydebug-test-env|python/);
  // Unsaved interpreter changes must invalidate the prior environment status.
  await run(`const input=[...document.querySelectorAll('.run-field')].find(r=>r.firstElementChild.textContent==='Python interpreter').querySelector('input');input.value=${JSON.stringify(path.join(setupEnv,'bin/python'))};input.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await run(`return document.querySelector('.run-debugpy-status').textContent.includes('found in current environment')`), false);
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('not installed') && !document.querySelector('.run-debugpy-install').disabled`, 'Missing dependency enables install');
  // Configure pip through the same draft environment sources used by Run.
  await run(`const row=[...document.querySelectorAll('.run-field')].find(r=>r.firstElementChild.textContent==='Environment variables');row.querySelector('button').click();`);
  await wait(`document.querySelector('.run-env-dialog')`, 'Environment variables');
  await run(`const row=document.querySelector('.run-env-row:not(:has(strong))');row.querySelectorAll('input')[0].value='PIP_FIND_LINKS';row.querySelectorAll('input')[1].value=${JSON.stringify(path.join(root,'absent-wheels'))};[...document.querySelectorAll('.run-env-dialog button')].find(b=>b.textContent==='Add variable').click();const last=[...document.querySelectorAll('.run-env-row')].at(-1);last.querySelectorAll('input')[0].value='PIP_NO_INDEX';last.querySelectorAll('input')[1].value='1';[...document.querySelectorAll('.run-env-dialog button')].find(b=>b.textContent==='OK').click();`);
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('not installed') && !document.querySelector('.run-debugpy-install').disabled`, 'Environment change rechecks');
  await pointer('.run-debugpy-install');
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('Installation failed') && !document.querySelector('.run-debugpy-install').disabled`, 'Failed install displays error and allows retry');
  assert.equal(await run(`return document.querySelector('.run-debugpy-details pre').textContent.includes('No matching distribution')`), true);
  await run(`[...document.querySelectorAll('.run-field')].find(r=>r.firstElementChild.textContent==='Environment variables').querySelector('button').click();`);
  await wait(`document.querySelector('.run-env-dialog')`, 'Retry environment variables');
  await run(`const row=[...document.querySelectorAll('.run-env-row')].find(r=>r.querySelector('input')?.value==='PIP_FIND_LINKS');row.querySelectorAll('input')[1].value=${JSON.stringify(wheels)};[...document.querySelectorAll('.run-env-dialog button')].find(b=>b.textContent==='OK').click();`);
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('not installed') && !document.querySelector('.run-debugpy-install').disabled`, 'Retry uses corrected environment');
  await pointer('.run-debugpy-install');
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('debugpy found in current environment')`, 'Install button runs real pip and rechecks', 300);
  assert.equal(await run(`return document.querySelector('.run-debugpy-details pre').textContent.includes('Successfully installed debugpy')`), true);
  const envPanel = await run(`const panel=document.querySelector('#run-panel-environment');panel.scrollTop=panel.scrollHeight;return panel.scrollWidth<=panel.clientWidth;`); assert(envPanel);
  window.setSize(760,650); await delay(100);
  assert.equal(await run(`const panel=document.querySelector('#run-panel-environment');return panel.scrollWidth<=panel.clientWidth`),true,'Debugger status and command fit a narrow dialog');
  window.setSize(1300,900); await delay(100);
  fs.writeFileSync(path.join(root,'debugpy-setup.png'),(await window.webContents.capturePage()).toPNG()); console.log('SETUP SCREENSHOT',path.join(root,'debugpy-setup.png'));
  await run(`const input=[...document.querySelectorAll('.run-field')].find(r=>r.firstElementChild.textContent==='Python interpreter').querySelector('input');input.value=${JSON.stringify(python)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait(`document.querySelector('.run-debugpy-status')?.textContent.includes('debugpy found in current environment')`, 'Original interpreter restored');
  await run(`[...document.querySelectorAll('.run-editor .workspace-dialog-footer button')].find(b=>b.textContent==='Save').click();`);
  await wait(`!document.querySelector('.run-editor')`, 'Saved configuration');
  console.log('PASS: configuration status, copy command, stale status invalidation, actual pointer install/recheck using unsaved environment, no overflow');
  await run(`await api.updateState({selectedRunConfigurationId:${JSON.stringify(config.configuration.id)}});window.dispatchEvent(new CustomEvent('marinashell:editor:open',{detail:{host:'__local__',tabId:'__local__',path:${JSON.stringify(source)}}}));`);
  await wait(`document.querySelectorAll('.mse-breakpoint-gutter .cm-gutterElement').length >= 6`, 'Python breakpoint gutter');
  await pointer('.mse-breakpoint-gutter .cm-gutterElement:nth-child(5)');
  await wait(`document.querySelector('.mse-breakpoint.present')`, 'Pointer adds breakpoint');
  const definitions = await run(`return api.invoke('plugin:pydebug:list')`); assert.equal(definitions.breakpoints.length, 1); assert.equal(definitions.breakpoints[0].line, 4);
  await run(`const select=document.querySelector('.run-launcher select');select.value=${JSON.stringify(config.configuration.id)};select.dispatchEvent(new Event('change'));`);
  await pointer('.run-debug');
  await wait(`document.querySelector('.mse-debug-line')`, 'Breakpoint opens/highlights source');
  await wait(`document.querySelector('.pd-frame.active')`, 'Selected call stack frame');
  assert.equal(await run(`return document.querySelector('.pd-frame.active').textContent.includes(':4')`), true);
  assert.equal(await run(`return document.querySelector('.mse-debug-companion').getBoundingClientRect().width > 200 && document.querySelector('.cm-editor').getBoundingClientRect().width > 100`), true);
  await run(`const details=document.querySelector('.pd-variable');details.open=true;`);
  await wait(`document.querySelector('.pd-content').textContent.includes('number: 41')`, 'Variables from real Python scope');
  await run(`const tabs=[...document.querySelectorAll('.mse-debug-companion .pd-tabs button')];tabs.find(b=>b.textContent==='Breakpoints').click();document.querySelector('.pd-breakpoint button:nth-of-type(2)').click();`);
  await wait(`document.querySelector('dialog input[aria-label="Python condition"]')`, 'Conditional breakpoint editor');
  await run(`document.querySelector('dialog input[aria-label="Python condition"]').value='number == 41';[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save breakpoint').click();`);
  await wait(`document.querySelector('.pd-condition')?.textContent==='number == 41'`, 'Persisted condition');
  await run(`const buttons=[...document.querySelectorAll('.mse-debug-companion .pd-actions button')];buttons.find(b=>b.textContent==='Disable all').click();`);
  await wait(`document.querySelector('.mse-breakpoint.disabled')`, 'Central list disables gutter breakpoint');
  await run(`[...document.querySelectorAll('.mse-debug-companion .pd-actions button')].find(b=>b.textContent==='Enable all').click();`);
  await wait(`document.querySelector('.mse-breakpoint.present:not(.disabled)')`, 'Central list enables gutter breakpoint');
  await run(`const tabs=[...document.querySelectorAll('.mse-debug-companion .pd-tabs button')];tabs.find(b=>b.textContent==='Watches').click();document.querySelector('input[aria-label="Watch expression"]').value='number + 1';[...document.querySelectorAll('.mse-debug-companion button')].find(b=>b.textContent==='Add watch').click();`);
  await wait(`document.querySelector('.pd-watch')?.textContent.includes('42')`, 'Real watch evaluation');
  await run(`[...document.querySelectorAll('.mse-debug-companion .pd-tabs button')].find(b=>b.textContent==='Console').click();document.querySelector('input[aria-label="Debug expression"]').value='payload["answer"]';[...document.querySelectorAll('.mse-debug-companion button')].find(b=>b.textContent==='Evaluate').click();`);
  await wait(`document.querySelector('.pd-console')?.textContent.includes('42')`, 'Real console evaluation');
  await run(`[...document.querySelectorAll('.mse-debug-companion .pd-tabs button')].find(b=>b.textContent==='Inspect').click();document.querySelector('.pd-variable').open=true;`);
  await wait(`document.querySelector('.pd-content').textContent.includes('number: 41')`, 'Inspection after central edits');
  const screenshot = path.join(root, 'pydebug.png'); fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
  console.log('SCREENSHOT', screenshot);
  const list = await run(`return api.invoke('plugin:pydebug:list')`); const session = list.sessions.find(s => s.state === 'paused'); assert(session);
  const restart = await run(`return api.invoke('plugin:run-configurations:restart',{id:${JSON.stringify(session.runId)}})`); assert.equal(restart.ok,true,restart.error); assert.equal(restart.run.executionMode,'debug');
  await wait(`document.querySelector('.mse-debug-line')`, 'Debug restart restores source stop');
  await run(`document.querySelector('.cm-content').focus();`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Up',modifiers:['meta']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Up',modifiers:['meta']});
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await wait(`window.marinashellEditorDocuments.list().some(d=>d.dirty) && !document.querySelector('.mse-debug-line')`, 'Source edit invalidates runtime highlight');
  await run(`[...document.querySelectorAll('.mse-debug-companion .pd-actions button')].find(b=>b.textContent==='Restart Debug').click();`);
  await wait(`document.querySelector('.mse-debug-line') && document.querySelector('.pd-frame.active')?.textContent.includes(':5')`, 'Restart saves source and remapped breakpoint');
  assert(fs.readFileSync(source,'utf8').startsWith('\n'),'Debug restart saves edited Python buffer');
  const activeLocal = (await run(`return api.invoke('plugin:pydebug:list')`)).sessions.find(s => s.state === 'paused');
  const localStop = await run(`return api.invoke('plugin:run-configurations:stop',{id:${JSON.stringify(activeLocal.runId)}})`); assert(localStop.ok, localStop.error);
  sshFixture = await require('./pydebug-ssh-fixture').createSshFixture(root);
  fs.mkdirSync(path.join(root, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ssh', 'config'), `Host pydebug-fixture\n  HostName 127.0.0.1\n  Port ${sshFixture.port}\n  User fixture\n`);
  const remote = await run(`return api.invoke('plugin:run-configurations:save',{configuration:{name:'SSH UI fixture',host:'pydebug-fixture',type:'python',mode:'script',interpreter:${JSON.stringify(python)},target:${JSON.stringify(source)},cwd:${JSON.stringify(root)}}})`); assert(remote.ok,remote.error);
  const remoteCheck = await run(`return api.invoke('plugin:run-configurations:debugpy-check',{configuration:${JSON.stringify(remote.configuration)}})`); assert(remoteCheck.ok,remoteCheck.error); assert(remoteCheck.status.compatible); assert.equal(remoteCheck.status.host,'pydebug-fixture');
  const remoteInstall = await run(`return api.invoke('plugin:run-configurations:debugpy-install',{configuration:${JSON.stringify(remote.configuration)}})`); assert(remoteInstall.ok,remoteInstall.error); assert.match(remoteInstall.output,/already found/);
  await run(`await api.invoke('plugin:pydebug:breakpoint-save',{breakpoint:{host:'pydebug-fixture',projectId:'',path:${JSON.stringify(source)},line:4,condition:'number == 41'}})`);
  const remoteStart = await run(`return api.invoke('plugin:pydebug:start',{configurationId:${JSON.stringify(remote.configuration.id)}})`); assert(remoteStart.ok,remoteStart.error);
  await wait(`document.querySelector('.pd-panel > select')?.selectedOptions[0]?.textContent.includes('SSH UI fixture') && document.querySelector('.mse-debug-line')`, 'SSH breakpoint opens remote source');
  const remoteSource = await run(`return api.invoke('plugin:pydebug:source',{sessionId:${JSON.stringify(remoteStart.session.id)},path:${JSON.stringify(source)}})`); assert(remoteSource.ok,remoteSource.error);
  const remoteRead = await run(`return api.invoke('plugin:editor:read',{...${JSON.stringify(remoteSource.file)}})`); assert(remoteRead.ok,remoteRead.error); assert.match(remoteRead.content,/number = 41/);
  assert.equal(remoteRead.stat.mtimeMs,Math.floor(fs.statSync(source).mtimeMs/1000)*1000,'SFTP adapter and editor must use the same millisecond timestamps');
  const remoteSave = await run(`return api.invoke('plugin:editor:save',{...${JSON.stringify(remoteSource.file)},content:${JSON.stringify(fs.readFileSync(source,'utf8')+'# saved over SFTP\n')},expectedStat:${JSON.stringify(remoteRead.stat)}})`); assert(remoteSave.ok,remoteSave.error); assert.match(fs.readFileSync(source,'utf8'),/saved over SFTP/);
  console.log('PASS: actual Session Manager SSH forwarding and SFTP source read/save, host-scoped conditional breakpoint and automatic remote editor activation');
  assert.deepEqual(await run(`return window.marinashellEditorDocuments.list().filter(d=>d.dirty)`), [], 'Save on Restart Debug must leave no dirty Python buffer');
  await updatePlugins(`const settings=await api.getSettings();settings.plugins.disabled.list.value=['pydebug'];await api.updateSettings(settings);`);
  await wait(`document.querySelector('.run-launcher')`, 'Run controls after plugin reload');
  await wait(`!document.querySelector('.run-debug')`, 'Disable removes debug button');
  const runs = await run(`return api.invoke('plugin:run-configurations:list')`); for(const record of runs.runs) { let status; for(let i=0;i<100;i++){const result=await run(`return api.invoke('plugin:run-configurations:status',{id:${JSON.stringify(record.id)}})`);status=result.run.status;if(status==='exited')break;await delay(100);} assert.equal(status,'exited','Disable must confirm owned process exit'); }
  console.log('PASS: real Electron plugin enable, Debug button, pointer breakpoint, paused source navigation/highlight, scoped values, condition editor, debug-preserving restart and disable cleanup');
}).catch(async error => {
  console.error(error); process.exitCode = 1;
  if(window && !window.isDestroyed()){
    const screenshot=path.join(root,'failure.png');fs.writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());console.log('FAILURE SCREENSHOT',screenshot);
    console.log(await run(`return document.body.innerText.slice(-3000)`));
  }
}).finally(async () => {
  if (window && !window.isDestroyed()) { try { const list=await run(`return api.invoke('plugin:run-configurations:list')`);for(const record of list.runs || []) await run(`return api.invoke('plugin:run-configurations:stop',{id:${JSON.stringify(record.id)},force:true})`); } catch (_) {} }
  // App's normal before-quit handler stops owned processes and closes SSH/PTYs.
  sshFixture?.close();
  if(window && !window.isDestroyed())window.destroy();
  if (process.exitCode) app.exit(process.exitCode); else app.quit();
});
