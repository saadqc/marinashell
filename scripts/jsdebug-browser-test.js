const assert = require('assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { createAdapter } = require('../plugins/jsdebug/adapter'); const { createJsDebugManager } = require('../plugins/jsdebug/session-manager'); const { createDebugStore } = require('../plugins/pydebug/store');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-browser-test-')); const adapter = createAdapter({ root }); const store = createDebugStore(root, 'jsdebug');
const browserPath = process.env.JSDEBUG_TEST_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const source = path.join(root, 'app.js'); fs.writeFileSync(source, 'window.answer = 40;\nwindow.answer += 2;\ndocument.querySelector("h1").textContent = String(window.answer);\nsetInterval(() => {}, 1000);\n');
const server = http.createServer((req, response) => { response.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); response.end(req.url === '/app.js' ? fs.readFileSync(source) : '<!doctype html><body><h1>Fixture</h1><script src="/app.js"></script></body>'); });
const debug = createJsDebugManager({ runs: {}, store, adapter });
let external;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function paused(id) { for (let i = 0; i < 200; i++) { const s = debug.list().find(s => s.id === id); if (s.state === 'paused') return s; if (s.state === 'failed') throw new Error(s.error); await delay(100); } throw new Error('Browser did not hit a source breakpoint'); }
async function test() {
  const archive = process.env.JSDEBUG_TEST_ARCHIVE || '/tmp/marina-js-debug-dap-v1.140.0.tar.gz'; await adapter.install(fs.existsSync(archive) ? archive : undefined);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  store.saveBreakpoint({ host: '__local__', projectId: 'browser', path: source, line: 3 });
  const input = { browser: 'chrome', mode: 'launch', url: `http://127.0.0.1:${server.address().port}`, webRoot: fs.realpathSync(root), runtimeExecutable: browserPath, headless: true, projectId: 'browser' };
  const started = await debug.browser(input); const s = await paused(started.session.id);
  const frames = await debug.request(s.id, 'stackTrace', { threadId: s.threadId }, s.generation); const frame = frames.stackFrames.find(f => f.source?.path === fs.realpathSync(source)); assert(frame); assert.equal(frame.line, 3);
  const value = await debug.request(s.id, 'evaluate', { frameId: frame.id, expression: 'window.answer', context: 'watch' }, s.generation); assert.equal(value.result, '42');
  const profile = debug.get(s.id).profileDirectory; assert(profile); assert.notEqual(profile, root);
  const restarted = await debug.restart(s.id); await paused(restarted.session.id); await debug.stop(restarted.session.id); assert(!fs.existsSync(profile));
  console.log('PASS: real headless Chrome launch, source breakpoint, watch evaluation, browser restart and private-profile cleanup');
  const externalProfile = path.join(root, 'external-profile'); fs.mkdirSync(externalProfile);
  external = require('child_process').spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${externalProfile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(externalProfile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await delay(100);
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  const attached = await debug.browser({ browser: 'chrome', mode: 'attach', host: '__local__', port, webRoot: fs.realpathSync(root), projectId: 'browser' });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const target = pages.find(page => page.type === 'page'); assert(target);
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl); socket.addEventListener('error', reject);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: input.url } })));
    socket.addEventListener('message', event => { const result = JSON.parse(event.data); if (result.id === 1) { socket.close(); resolve(); } });
  });
  await paused(attached.session.id); await debug.stop(attached.session.id);
  assert.equal(external.exitCode, null, 'Disconnect must preserve an externally attached browser'); external.kill();
  console.log('PASS: real Chrome attach, page source breakpoint and non-terminating disconnect');
}
test().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { external?.kill(); await debug.shutdown(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
