const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRunManager } = require('../plugins/run-configurations/manager');
const exec = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-recovery-'));
const bootCommand = 'if [ -r /proc/sys/kernel/random/boot_id ]; then cat /proc/sys/kernel/random/boot_id; else sysctl -n kern.boottime; fi';
let currentBoot = '{ sec = 200, usec = 20 } Tue Oct 20 03:07:20 2026';
let unavailable = false;
const commands = [];
async function execute(_host, command, options = {}) {
  commands.push(command);
  if (unavailable) throw new Error('Execution host disconnected');
  if (command === bootCommand) return { stdout: currentBoot, exitCode: 0 };
  if (command === 'printf "%s" "$HOME"') return { stdout: root, exitCode: 0 };
  try { return { ...await exec('/bin/bash', ['-c', command], { timeout: options.timeoutMs === 0 ? 0 : 15000 }), exitCode: 0 }; }
  catch (error) { return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.code || 1 }; }
}
let manager;
(async () => {
  const id = randomUUID(), configurationId = randomUUID();
  const dir = path.join(root, '.marinashell', 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  // This fixture uses the old protocol and a leftover running state, as on a
  // real reboot. No test PID is ever sent a signal.
  fs.writeFileSync(path.join(dir, 'runner.sh'), '#!/bin/bash\ncd "$2"\nprintf "unknown\\n\\n999999999\\n999999998\\nold identity\\nold child\\n"\ncat boot\nprintf "0\\n12\\n"\nprintf "old output" | base64\n');
  fs.writeFileSync(path.join(dir, 'boot'), '{ sec = 100, usec = 10 } Thu Oct 15 19:19:35 2026\n');
  fs.writeFileSync(path.join(root, 'run-records.json'), JSON.stringify([{ id, configurationId, host: '__local__', hostIdentity: 'fixture', home: root, status: 'unknown', name: 'Previous boot', closed: false }]));
  manager = createRunManager({ execute, hostIdentity: async () => 'fixture', root });
  manager.configs.upsert({ id: configurationId, name: 'Recovered', host: '__local__', type: 'shell', mode: 'commands', target: 'echo recovered', cwd: root });
  const status = await manager.status(id);
  assert.equal(status.status, 'exited'); assert.equal(status.endReason, 'host-restarted'); assert.equal(status.exitCode, null);
  assert.match(status.error, /restarted/);
  const output = await manager.poll(id, 0, 0);
  assert.equal(output.run.status, 'exited'); assert.equal(output.output, 'old output');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'run-records.json')))[0].status, 'exited');
  // A stale single-instance lock from the same old boot must also recover.
  const lock = path.join(root, '.marinashell', 'run-locks', createHash('sha256').update(configurationId).digest('hex'));
  fs.mkdirSync(lock, { recursive: true }); fs.writeFileSync(path.join(lock, 'run'), dir);
  const launched = await manager.start(configurationId);
  assert.notEqual(launched.id, id);
  for (let i = 0; i < 80; i++) {
    if ((await manager.status(launched.id)).status === 'exited') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await manager.status(launched.id)).status, 'exited');
  // Same boot, even with a different formatted date, cannot prove exit.
  currentBoot = '{ sec = 100, usec = 10 } different timezone and locale';
  assert.equal((await manager.status(id)).status, 'unknown');
  await assert.rejects(manager.stop(id, true), /owner cannot be verified/);
  // A failed boot probe, malformed identity, or disconnected host stays blocked.
  currentBoot = '';
  assert.equal((await manager.status(id)).status, 'unknown');
  currentBoot = '{ sec = 200, usec = 20 } current';
  fs.writeFileSync(path.join(dir, 'boot'), 'invalid\n');
  assert.equal((await manager.status(id)).status, 'unknown');
  unavailable = true;
  assert.equal((await manager.status(id)).status, 'unknown');
  unavailable = false;
  // Linux UUIDs follow the same rules, including case-insensitive comparison.
  fs.writeFileSync(path.join(dir, 'boot'), '00000000-0000-0000-0000-00000000000a\n');
  currentBoot = '00000000-0000-0000-0000-00000000000A';
  assert.equal((await manager.status(id)).status, 'unknown');
  currentBoot = '00000000-0000-0000-0000-00000000000b';
  assert.equal((await manager.poll(id, 0, 0)).run.status, 'exited');
  assert(!commands.some(command => command.startsWith('bash ') && command.includes("runner.sh' control ")), 'Recovery must never signal an unverified process');
  console.log('PASS: previous-boot recovery, legacy runner/lock, output retention, unknown exit code, same-boot ownership, malformed boot and disconnect safety, macOS/Linux identities');
})().finally(async () => { await manager?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });
