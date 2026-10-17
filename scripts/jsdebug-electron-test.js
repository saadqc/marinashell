const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-jsdebug-ui-'));
const node = process.env.JSDEBUG_TEST_NODE || require('child_process').execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const library = path.join(root, '.marinashell'); fs.mkdirSync(library);
if (process.env.JSDEBUG_TEST_ADAPTER_NODE) fs.writeFileSync(path.join(library, 'jsdebug-settings.json'), JSON.stringify([{ id: 'settings', nodePath: process.env.JSDEBUG_TEST_ADAPTER_NODE }]));
const file = path.join(root, 'fixture.cjs'); fs.writeFileSync(file, 'let number = 41;\nconst payload = {answer: number + 1};\nnumber += 1;\nsetTimeout(() => console.log(payload.answer), 30000);\n');
os.homedir = () => root; process.env.HOME = root; app.setPath('userData', root);
fs.writeFileSync(path.join(library, 'settings.json'), JSON.stringify({ plugins: { enabled: { list: { value: ['editor', 'run-configurations', 'pydebug', 'jsdebug'] } } }, ui: { session: { restoreTabs: { value: true } } } }));
fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ tabs: [{ id: 'fixture', host: '__local__', currentPath: root, sessionType: 'local', connected: true }], activeTabId: 'fixture' }));
const archive = process.env.JSDEBUG_TEST_ARCHIVE || '/tmp/marina-js-debug-dap-v1.140.0.tar.gz';
const installation = require('../plugins/jsdebug/adapter').createAdapter({ root: library }).install(fs.existsSync(archive) ? archive : undefined);
if (process.env.MARINASHELL_TEST_APP) { app.setAppPath(process.env.MARINASHELL_TEST_APP); require(path.join(process.env.MARINASHELL_TEST_APP, 'main/app')); } else require('../main/app');
let window;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); const run = code => window.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
async function wait(code, label) { for (let i = 0; i < 200; i++) { if (await run(`return Boolean(${code})`)) return; await delay(100); } throw new Error('Timed out: ' + label); }
app.whenReady().then(async () => {
  await installation;
  for (let i = 0; i < 100; i++) { window = BrowserWindow.getAllWindows()[0]; if (window && !window.webContents.isLoading()) break; await delay(50); }
  window.setSize(1300, 900); window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('[renderer]', message); });
  await wait(`document.querySelectorAll('.run-debug').length===2`, 'Both debugger plugins contribute run actions');
  const status = await run(`return api.invoke('plugin:jsdebug:adapter-status')`); assert(status.status.installed);
  const config = await run(`return api.invoke('plugin:run-configurations:save',{configuration:{name:'JavaScript UI fixture',host:'__local__',type:'javascript',mode:'script',target:${JSON.stringify(file)},cwd:${JSON.stringify(root)},interpreter:${JSON.stringify(node)}}})`); assert(config.ok, config.error);
  await wait(`document.querySelector('.run-launcher select option[value="${config.configuration.id}"]')`, 'JavaScript run configuration');
  await run(`const select=document.querySelector('.run-launcher select');select.value=${JSON.stringify(config.configuration.id)};select.dispatchEvent(new Event('change'));window.dispatchEvent(new CustomEvent('marinashell:editor:open',{detail:{host:'__local__',tabId:'fixture',path:${JSON.stringify(file)}}}));`);
  await wait(`document.querySelector('.mse-breakpoint-gutter')`, 'JavaScript breakpoint gutter');
  const saved = await run(`return api.invoke('plugin:jsdebug:breakpoint-save',{breakpoint:{host:'__local__',projectId:'',path:${JSON.stringify(file)},line:3,condition:'number === 41'}})`); assert(saved.ok, saved.error);
  await wait(`document.querySelector('.mse-breakpoint.present')`, 'JavaScript breakpoint marker');
  await run(`document.querySelector('.mse-debug-toggle').click()`);
  await wait(`document.querySelector('.mse-debug-companion.collapsed')`, 'Shared collapse preference');
  await run(`document.querySelector('.run-debug[title="Debug JavaScript"]').click()`);
  await wait(`document.querySelector('.mse-debug-line') && document.querySelector('.pd-frame.active')`, 'JavaScript breakpoint source navigation');
  assert.equal(await run(`return document.querySelector('.mse-debug-body strong').textContent`), 'JSDebug');
  assert.equal(await run(`return document.querySelector('.mse-debug-toggle').getAttribute('aria-expanded')`), 'true');
  const s = await run(`return (await api.invoke('plugin:jsdebug:list')).sessions.find(s=>s.state==='paused')`); assert(s);
  const restarted = await run(`return api.invoke('plugin:run-configurations:restart',{id:${JSON.stringify(s.runId)}})`); assert(restarted.ok, restarted.error); assert.equal(restarted.run.debuggerId, 'jsdebug');
  await wait(`document.querySelector('.mse-debug-line')`, 'JavaScript restart preserves debugger');
  const stopped = await run(`return api.invoke('plugin:run-configurations:stop',{id:${JSON.stringify(restarted.run.id)}})`); assert(stopped.ok, stopped.error);
  const python = await run(`return api.invoke('plugin:pydebug:list')`); assert(python.ok); assert.equal(python.breakpoints.length, 0, 'Python and JS breakpoints remain separate');
  fs.writeFileSync(path.join(root, 'jsdebug.png'), (await window.webContents.capturePage()).toPNG()); console.log('SCREENSHOT', path.join(root, 'jsdebug.png'));
  console.log('PASS: real Electron with Python and JavaScript plugins enabled together, JS gutter/conditional breakpoint, temporary reveal, source inspection and generic run restart/stop');
}).catch(async error => { console.error(error); process.exitCode = 1; if (window && !window.isDestroyed()) { fs.writeFileSync(path.join(root, 'failure.png'), (await window.webContents.capturePage()).toPNG()); console.log('FAILURE', root); console.log(await run(`return document.body.innerText.slice(-2000)`)); } })
.finally(async () => { if (window && !window.isDestroyed()) { try { const list = await run(`return api.invoke('plugin:run-configurations:list')`); for (const record of list.runs || []) await run(`return api.invoke('plugin:run-configurations:stop',{id:${JSON.stringify(record.id)},force:true})`); } catch {} window.destroy(); } if (process.exitCode) app.exit(1); else app.quit(); });
