const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { Duplex } = require('stream');
const { spawn, execFileSync } = require('child_process');
const { generateKeyPairSync } = require('crypto');
const { Server, Client } = require('ssh2');
const { DapClient } = require('../plugins/pydebug/dap-client');
const { createDebugManager } = require('../plugins/pydebug/session-manager');
const { createDebugStore } = require('../plugins/pydebug/store');
const { createRunManager } = require('../plugins/run-configurations/manager');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-pydebug-'));
const python = process.env.PYDEBUG_TEST_PYTHON || '/tmp/marinashell-pydebug-test-env/bin/python';
const delay = ms => new Promise(r => setTimeout(r, ms));
let server, client; const peers = new Set(); const children = new Set(); let manager, debug;
function wire(message) { const body = Buffer.from(JSON.stringify(message)); return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]); }
async function protocolTest() {
  const writes = [];
  const stream = new Duplex({ read() {}, write(chunk, _encoding, callback) { writes.push(chunk); callback(); } });
  const dap = new DapClient(stream, { timeoutMs: 50 });
  const request = dap.request('evaluate', { expression: '"é"' });
  const response = wire({ type: 'response', request_seq: 1, success: true, body: { result: 'é🔥' } });
  for (const byte of response) stream.push(Buffer.from([byte]));
  assert.equal((await request).result, 'é🔥');
  const events = []; dap.on('event', e => events.push(e.event));
  stream.push(Buffer.concat([wire({ type: 'event', event: 'stopped' }), wire({ type: 'event', event: 'continued' })]));
  await delay(10); assert.deepEqual(events, ['stopped', 'continued']);
  await assert.rejects(dap.request('timeout'), /timed out/);
  const pending = dap.request('pending'); dap.close(); await assert.rejects(pending, /disconnected/);
  const bad = new Duplex({ read() {}, write(_chunk, _encoding, cb) { cb(); } });
  const invalid = new DapClient(bad); let lost = false; invalid.on('disconnected', () => lost = true);
  bad.push(Buffer.from('Bad: header\r\n\r\n{}')); await delay(10); assert(lost);
}
function executeLocal(_host, command) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], { env: { ...process.env, HOME: root } }); children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', exitCode => { children.delete(child); resolve({ stdout, stderr, exitCode }); });
  });
}
async function sshSetup() {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  server = new Server({ hostKeys: [key.privateKey] }, peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer)); peer.on('authentication', ctx => ctx.accept());
    peer.on('ready', () => {
      peer.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1') return reject();
        const socket = net.connect(info.destPort, '127.0.0.1');
        socket.once('connect', () => { const channel = accept(); socket.pipe(channel).pipe(socket); channel.on('close', () => socket.destroy()); });
        socket.on('error', () => reject());
      });
      peer.on('session', accept => { const session = accept(); session.on('exec', (accept, _reject, info) => {
        const stream = accept(); const child = spawn('/bin/bash', ['-c', info.command], { env: { ...process.env, HOME: root } }); children.add(child);
        child.stdout.on('data', data => { if (!stream.destroyed) stream.write(data); }); child.stderr.on('data', data => { if (!stream.destroyed) stream.stderr.write(data); });
        child.on('close', code => { children.delete(child); if (!stream.destroyed) { stream.exit(code || 0); stream.end(); } });
        stream.on('close', () => { if (child.exitCode == null) child.kill('SIGHUP'); });
      }); });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  client = new Client(); await new Promise((resolve, reject) => client.once('ready', resolve).once('error', reject).connect({ host: '127.0.0.1', port: server.address().port, username: 'test', password: 'test' }));
}
function executeSsh(_host, command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error); let stdout = '', stderr = '', exitCode = null;
    stream.on('data', data => stdout += data); stream.stderr.on('data', data => stderr += data); stream.on('exit', code => exitCode = code);
    stream.on('close', () => resolve({ stdout, stderr, exitCode })); stream.on('error', reject);
  }));
}
async function waitPaused(id) {
  for (let i = 0; i < 150; i++) {
    const s = debug.list().find(s => s.id === id);
    if (s.state === 'paused') return s;
    if (['failed', 'ended', 'disconnected'].includes(s.state)) throw new Error(JSON.stringify(s));
    await delay(100);
  }
  throw new Error('Fixture did not pause');
}
async function integration(host, execute) {
  const library = path.join(root, host.replace(/\W/g, '')); fs.mkdirSync(library);
  manager = createRunManager({ root: library, execute, hostIdentity: async () => host });
  const store = createDebugStore(library);
  debug = createDebugManager({ runs: manager, store, openTransport: (_host, port) => new Promise((resolve, reject) => client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (error, stream) => error ? reject(error) : resolve(stream))) });
  const file = path.join(root, 'fixture.py');
  fs.writeFileSync(file, 'import os\nimport sys\nfor number in range(3):\n    payload = {"number": number, "nested": [1, 2, 3]}\n    marker = number * 2\nprint("DONE", sys.argv[1], os.environ["FIXTURE_VALUE"])\n');
  const setup = path.join(root, 'setup.sh'); fs.writeFileSync(setup, `echo once >> ${JSON.stringify(path.join(library, 'setup-count'))}\nexport FIXTURE_VALUE=prepared\n`);
  const config = manager.configs.upsert({ name: 'Fixture', host, type: 'python', mode: 'script', interpreter: python, target: file, args: '"argument with spaces"', cwd: root, setupScripts: [setup] });
  const breakpoint = store.saveBreakpoint({ host, projectId: 'fixture', path: file, line: 5, condition: 'number == 1' });
  store.saveBreakpoint({ host: 'other-host', projectId: 'fixture', path: file, line: 5 });
  assert.equal(createDebugStore(library).breakpoints.read().find(b=>b.id===breakpoint.id).condition,'number == 1');
  const started = await debug.start(config.id, 'fixture', 'Fixture');
  assert.equal(started.run.executionMode, 'debug');
  assert.equal(fs.readFileSync(path.join(library, 'setup-count'), 'utf8').trim(), 'once');
  const paused = await waitPaused(started.session.id); assert(paused.capabilities.supportsConditionalBreakpoints);
  const frames = await debug.request(paused.id, 'stackTrace', { threadId: paused.threadId }, paused.generation);
  const frame = frames.stackFrames.find(f => f.source?.path === file); assert(frame); assert.equal(frame.line, 5);
  const scopes = await debug.request(paused.id, 'scopes', { frameId: frame.id }, paused.generation); assert(scopes.scopes.length);
  const values = await debug.request(paused.id, 'variables', { variablesReference: scopes.scopes[0].variablesReference }, paused.generation);
  assert(values.variables.some(v => v.name === 'number' && v.value === '1'));
  const evaluated = await debug.request(paused.id, 'evaluate', { frameId: frame.id, expression: 'payload["number"]', context: 'watch' }, paused.generation); assert.equal(evaluated.result, '1');
  await assert.rejects(manager.restart(started.run.id), /Restart Debug/);
  await assert.rejects(manager.start(config.id), /changing execution mode/);
  await debug.action(paused.id, 'next'); const stepped = await waitPaused(paused.id); assert(stepped.generation > paused.generation);
  await assert.rejects(debug.request(paused.id, 'scopes', { frameId: frame.id }, paused.generation), /no longer paused/);
  await debug.stop(paused.id); assert.equal((await manager.status(started.run.id)).status, 'exited');
  const restarted = await debug.restart(paused.id); await waitPaused(restarted.session.id); assert.notEqual(restarted.run.id, started.run.id);
  store.saveBreakpoint({ ...breakpoint, enabled: false }); await debug.sync(); await debug.action(restarted.session.id, 'continue');
  for (let i = 0; i < 80 && (await manager.status(restarted.run.id)).status !== 'exited'; i++) await delay(100);
  assert.equal((await manager.status(restarted.run.id)).status, 'exited');
  const output = await manager.poll(restarted.run.id, 0, 0); assert.match(output.output, /DONE argument with spaces prepared/);
  assert.equal(manager.configs.read()[0].args, '"argument with spaces"');
  store.saveBreakpoint({ ...breakpoint, enabled: true }); await debug.sync();
  const disconnected = await debug.start(config.id, 'fixture'); await waitPaused(disconnected.session.id);
  debug.get(disconnected.session.id).client.stream.destroy(new Error('Fixture connection lost'));
  for (let i=0;i<100 && debug.get(disconnected.session.id).state!=='ended';i++) await delay(100);
  assert.equal(debug.get(disconnected.session.id).state,'ended');
  assert.equal((await manager.status(disconnected.run.id)).status,'exited');
  if (host === '__local__') for (const condition of ['number ==', 'missing_name > 0']) {
    store.saveBreakpoint({ ...breakpoint, condition }); await debug.sync();
    const invalid = await debug.start(config.id,'fixture');
    for(let i=0;i<100 && (await manager.status(invalid.run.id)).status!=='exited';i++)await delay(100);
    assert.equal((await manager.status(invalid.run.id)).status,'exited');
    const conditionError=debug.list().find(s=>s.id===invalid.session.id).conditionError;
    if(condition==='number ==')assert.match(conditionError,/conditional breakpoint/);
    else assert.equal(conditionError,''); // debugpy 1.8.17 treats an unavailable name as a silent non-hit.
  }
  if (host === '__local__') {
    const exceptionFile=path.join(root,'exception.py');fs.writeFileSync(exceptionFile,'import time\ntime.sleep(1)\nraise ValueError("fixture exception")\n');
    const exceptionConfig=manager.configs.upsert({...config,id:'exception-fixture',target:exceptionFile});
    const exception=await debug.start(exceptionConfig.id,'fixture'); await debug.exceptionFilters(exception.session.id,true);
    assert.equal((await waitPaused(exception.session.id)).reason,'exception'); await debug.stop(exception.session.id);
  }
  if (host !== '__local__') {
    const denied = createDebugManager({runs:manager,store,openTransport:async()=>{throw new Error('SSH forwarding denied by fixture');}});
    await assert.rejects(denied.start(config.id,'fixture'),/SSH forwarding denied/);
    const failed=denied.list()[0]; assert.equal((await manager.status(failed.runId)).status,'exited'); await denied.shutdown();
  }
  await debug.shutdown(); await manager.shutdown();
  console.log(`PASS: ${host} real debugpy condition, frame/scopes/values, watch, step, stale-frame rejection, stop/restart, single-instance gating and prepared environment`);
}
(async () => {
  execFileSync(python, ['-c', 'import debugpy; assert debugpy.__version__ == "1.8.17"']);
  await protocolTest(); await integration('__local__', executeLocal); await sshSetup(); await integration('fixture-ssh', executeSsh);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await debug?.shutdown(); await manager?.shutdown(); client?.end(); for (const peer of peers) peer.end(); server?.close();
  for (const child of children) child.kill('SIGTERM'); fs.rmSync(root, { recursive: true, force: true });
});
