const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { generateKeyPairSync, randomUUID } = require('crypto');
const { Server, Client } = require('ssh2');
const { createRunManager } = require('../plugins/run-configurations/manager');
const { normalize } = require('../plugins/run-configurations/configuration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-ssh-test-'));
const socket = `marina-test-${randomUUID()}`;
const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
let client, server, manager; const channels = new Set(); const peers = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() {
  client = new Client();
  await new Promise((resolve, reject) => { client.once('ready', resolve).once('error', reject).connect({ host: '127.0.0.1', port: server.address().port, username: 'fixture', password: 'fixture' }); });
}
async function execute(_host, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '', stderr = '', exitCode = null;
      stream.on('data', data => stdout += data); stream.stderr.on('data', data => stderr += data);
      stream.on('exit', code => exitCode = code);
      stream.on('close', () => resolve({ stdout, stderr, exitCode })); stream.on('error', reject);
    });
  });
}
(async () => {
  try { execFileSync('tmux', ['-V']); } catch (_) { console.log('SKIP: install tmux to run the SSH persistence test'); return; }
  server = new Server({ hostKeys: [key.privateKey] }, peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', ctx => ctx.accept());
    peer.on('ready', () => peer.on('session', accept => {
      const session = accept(); session.on('exec', (accept, _reject, info) => {
        const stream = accept();
        if (info.command === 'printf "%s" "$HOME"') { stream.write(root); stream.exit(0); stream.end(); return; }
        // A private tmux socket keeps the test isolated from user sessions.
        const command = info.command.replace(/\btmux (has-session|new-window|new-session|list-sessions)/g, `tmux -L ${socket} $1`);
        const child = spawn('/bin/bash', ['-c', command]); channels.add(child);
        child.stdout.on('data', data => { if (!stream.destroyed) stream.write(data); });
        child.stderr.on('data', data => { if (!stream.destroyed) stream.stderr.write(data); });
        child.on('close', code => { channels.delete(child); if (!stream.destroyed) { stream.exit(code || 0); stream.end(); } });
        stream.on('close', () => { if (child.exitCode === null) child.kill('SIGHUP'); });
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); await connect();
  manager = createRunManager({ execute, hostIdentity: async () => 'test-ssh-host', tmuxAvailable: () => true, root });
  const config = manager.configs.upsert(normalize({ name: 'Persistent SSH', type: 'shell', mode: 'commands', host: 'test-ssh', target: 'echo READY; trap "exit 0" TERM; while :; do echo heartbeat; sleep 1; done', cwd: root, tmux: true, tmuxSession: 'project-session' }));
  const run = await manager.start(config.id); assert.equal(run.status, 'running'); assert(run.tmuxPaneId);
  client.end(); await delay(1300); await connect();
  const recovered = createRunManager({ execute, hostIdentity: async () => 'test-ssh-host', tmuxAvailable: () => true, root });
  const result = await recovered.poll(run.id, 0, 0);
  assert.equal(result.run.status, 'running'); assert.match(result.output, /heartbeat/);
  assert.equal((await recovered.start(config.id)).id, run.id);
  // Reuse the same named session; each config has a separate managed window.
  const secondConfig = recovered.configs.upsert({ ...config, id: randomUUID(), name: 'Second SSH run' });
  const second = await recovered.start(secondConfig.id);
  assert.equal(second.tmuxSessionId, run.tmuxSessionId); assert.notEqual(second.tmuxWindowId, run.tmuxWindowId);
  await recovered.stop(run.id, true);
  for (let i=0;i<40;i++) { if ((await recovered.poll(run.id)).run.status === 'exited') break; await delay(100); }
  assert.equal((await recovered.poll(run.id)).run.status, 'exited');
  assert.equal((await recovered.poll(second.id)).run.status, 'running');
  await recovered.stop(second.id, true);
  for (let i=0;i<40;i++) { if ((await recovered.poll(second.id)).run.status === 'exited') break; await delay(100); }
  assert.equal((await recovered.poll(second.id)).run.status, 'exited');
  const disabled = createRunManager({ execute, hostIdentity: async () => 'test-ssh-host', tmuxAvailable: () => false, root });
  await assert.rejects(disabled.start(config.id), /tmux plugin/);
  console.log('PASS: real SSH transport, tmux disconnect/reconnect, persisted run recovery, single-instance reuse, named-session window isolation, plugin gating');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }); } catch (_) {}
  client?.end(); for (const peer of peers) peer.end();
  for (const child of channels) child.kill('SIGTERM');
  server?.close(); fs.rmSync(root, { recursive: true, force: true });
});
