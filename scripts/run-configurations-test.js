const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { createRunManager } = require('../plugins/run-configurations/manager');
const { parseArguments, parseEnv, buildCommand, normalize: normalizeConfig } = require('../plugins/run-configurations/configuration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-runs-test-'));
const execute = async (_host, command, options = {}) => {
  if (command === 'printf "%s" "$HOME"') return { stdout: root, stderr: '', exitCode: 0 };
  try { const result = await exec('/bin/bash', ['-c', command], { timeout: options.timeoutMs === 0 ? 0 : 15000, maxBuffer: 2 * 1024 * 1024 }); return { ...result, exitCode: 0 }; }
  catch (error) { return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: typeof error.code === 'number' ? error.code : 1 }; }
};
const manager = createRunManager({ execute, hostIdentity: async () => 'test-machine', root });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitExit(id) {
  for (let i = 0; i < 80; i++) {
    const result = await manager.poll(id, 0, 0);
    if (['exited', 'blocked'].includes(result.run.status)) return result;
    await delay(100);
  }
  throw new Error(`Run did not exit: ${id}`);
}
(async () => {
  assert.deepEqual(parseArguments('a "two words" \'\' \'$(touch nope)\''), ['a', 'two words', '', '$(touch nope)']);
  assert.throws(() => parseArguments('"unfinished'));
  assert.deepEqual(parseEnv('A=one # comment\nB="two\\nlines"\nC=\'$(literal)\'\nexport D=ok'), { A: 'one', B: 'two\nlines', C: '$(literal)', D: 'ok' });
  const shellInit = path.join(root, 'shell-init'); fs.writeFileSync(shellInit, 'export FROM_INIT=loaded\nexport WINNER=startup\n');
  const shellScript = path.join(root, 'not-executable.sh'); fs.writeFileSync(shellScript, 'printf "%s|%s|%s" "$FROM_INIT" "$WINNER" "$1"');
  const sourced = buildCommand({ name: 'Sourced', type: 'shell', mode: 'script', target: shellScript, sourceFile: shellInit, interpreter: fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash', cwd: root, args: '"two words"', env: { WINNER: 'modal' } });
  assert.equal((await execute('__local__', sourced)).stdout, 'loaded|modal|two words');
  const python = path.join(root, 'module_case.py'); fs.writeFileSync(python, 'import sys, os\nprint("python:" + sys.argv[1] + ":" + os.getcwd())\n');
  const py = buildCommand({ name: 'Python', type: 'python', mode: 'module', target: 'module_case', cwd: root, args: '"two words"' });
  assert.equal((await execute('__local__', py)).stdout.trim(), 'python:two words:' + fs.realpathSync(root));
  const js = path.join(root, 'module_case.mjs'); fs.writeFileSync(js, 'console.log("node:" + process.argv[2])');
  const node = buildCommand({ name: 'Node', type: 'javascript', mode: 'module', target: js, interpreter: process.execPath, cwd: root, args: '"two words"' });
  assert.equal((await execute('__local__', node)).stdout.trim(), 'node:two words');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node module_case.mjs' } }));
  const npm = buildCommand({ name: 'npm', type: 'javascript', mode: 'npm', target: 'verify', interpreter: process.execPath, cwd: root, args: '"two words"' });
  assert.match((await execute('__local__', npm)).stdout, /node:two words/);
  const malicious = '$(touch ' + path.join(root, 'injected') + ')';
  const envFile = path.join(root, 'values.env'); fs.writeFileSync(envFile, 'WINNER=file\nFILE_ONLY=yes\n');
  const config = manager.configs.upsert({ name: 'Output', type: 'shell', host: '__local__', mode: 'commands', target: 'printf "%s|%s|%s\\n" "$WINNER" "$FILE_ONLY" "$LITERAL"; exit 7', cwd: root, envFiles: [envFile], env: { WINNER: 'modal', LITERAL: malicious } });
  const run = await manager.start(config.id);
  const result = await waitExit(run.id);
  assert.equal(result.run.exitCode, 7); assert.match(result.output, /modal\|yes\|\$\(touch/);
  assert.equal(fs.existsSync(path.join(root, 'injected')), false);
  await manager.close(run.id); assert.equal(manager.list().length, 0);
  const slow = manager.configs.upsert({ name: 'Single', type: 'shell', mode: 'commands', target: 'trap "" TERM; while :; do sleep 1; done', cwd: root, multiInstance: false });
  const first = await manager.start(slow.id);
  assert.equal((await manager.start(slow.id)).id, first.id);
  await manager.stop(first.id); await delay(350);
  assert.equal((await manager.poll(first.id)).run.status, 'stopping');
  await manager.stop(first.id); await waitExit(first.id);
  // Restart survives a new manager instance (records are independent of tabs).
  const restored = createRunManager({ execute, hostIdentity: async () => 'test-machine', root });
  assert(restored.list().some(item => item.id === first.id));
  const again = await manager.start(slow.id); assert.notEqual(again.id, first.id);
  const changedHost = createRunManager({ execute, hostIdentity: async () => 'different-machine', root });
  await assert.rejects(changedHost.stop(again.id, true), /host settings changed/);
  await manager.stop(again.id, true); await waitExit(again.id);
  const multi = manager.configs.upsert({ ...slow, id: undefined, name: 'Multiple', multiInstance: true });
  const a = await manager.start(multi.id); const b = await manager.start(multi.id);
  assert.notEqual(a.id, b.id);
  await manager.stop(a.id, true); await waitExit(a.id);
  assert.equal((await manager.poll(b.id)).run.status, 'running');
  await manager.stop(b.id, true); await waitExit(b.id);
  // A launcher may exit on TERM while a worker ignores it. Keep ownership
  // and the tab alive until a second Stop terminates the whole job.
  const workerScript = path.join(root, 'worker.js');
  fs.writeFileSync(workerScript, `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('WORKER_READY');`);
  const parentScript = path.join(root, 'parent.js');
  fs.writeFileSync(parentScript, `require('child_process').spawn(process.execPath, [${JSON.stringify(workerScript)}], {stdio:'inherit'}); setInterval(()=>{},1000);`);
  const tree = manager.configs.upsert(normalizeConfig({ name: 'Worker tree', type: 'javascript', mode: 'script', target: parentScript, interpreter: process.execPath, cwd: root }));
  const treeRun = await manager.start(tree.id);
  for (let i=0;i<20;i++) { if ((await manager.poll(treeRun.id)).output.includes('WORKER_READY')) break; await delay(100); }
  await manager.stop(treeRun.id); await delay(400);
  assert.equal((await manager.poll(treeRun.id)).run.status, 'stopping');
  await manager.stop(treeRun.id, true); await waitExit(treeRun.id);
  const verbose = manager.configs.upsert(normalizeConfig({ name: 'Long output', type: 'shell', mode: 'commands', target: "head -c 600000 /dev/zero | tr '\\0' x", cwd: root }));
  const large = await manager.start(verbose.id); await waitExit(large.id);
  let offset = 0, generation = 0, output = '';
  for (let i = 0; i < 4; i++) { const page = await manager.poll(large.id, offset, generation); output += page.output; offset = page.offset; generation = page.generation; if (!page.hasMore) break; }
  assert.equal(output.length, 600000);
  console.log('PASS: argv/env quoting, env precedence, exit/output, single/multiple instances, repeated Stop, persistence and host identity');
})().finally(async () => { await manager.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });
