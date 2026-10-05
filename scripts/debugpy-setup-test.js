// Real pip installations, isolated interpreters and an authenticated SSH fixture.
const assert = require('assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn, execFileSync } = require('child_process'); const { Client } = require('ssh2');
const { createRunManager } = require('../plugins/run-configurations/manager');
const { createDebugpyEnvironment } = require('../plugins/run-configurations/debugpy-environment');
const { quote } = require('../plugins/run-configurations/configuration');
const { createSshFixture } = require('./pydebug-ssh-fixture');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marina-debugpy-setup-')));
const basePython = process.env.PYDEBUG_TEST_PYTHON || '/tmp/marinashell-pydebug-test-env/bin/python';
const wheels = path.join(root, 'wheels'); fs.mkdirSync(wheels);
let fixture, client;
function local(_host, command) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], { env: { ...process.env, HOME: root } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
  });
}
function ssh(_host, command) {
  return new Promise((resolve, reject) => client.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = '', stderr = '', exitCode = null;
    stream.on('data', data => stdout += data); stream.stderr.on('data', data => stderr += data);
    stream.on('exit', code => exitCode = code); stream.on('error', reject);
    stream.on('close', () => resolve({ stdout, stderr, exitCode }));
  }));
}
async function verify(host, execute) {
  const dir = path.join(root, host); fs.mkdirSync(dir);
  // Deliberate spaces and shell metacharacters verify argv/path quoting.
  const envPath = path.join(dir, "env space ' $(touch SHOULD_NOT_EXIST)");
  execFileSync(basePython, ['-m', 'venv', envPath]);
  const interpreter = path.join(envPath, 'bin/python');
  const manager = createRunManager({ root: dir, execute, hostIdentity: async () => host });
  const setup = createDebugpyEnvironment({ manager, execute });
  const config = { type: 'python', host: host === 'local' ? '__local__' : host, interpreter, cwd: dir,
    target: '', args: 'unfinished "', killPortOnLaunch: true, killPort: 12345,
    env: { PIP_NO_INDEX: '1', PIP_FIND_LINKS: wheels } };
  const missing = await setup.check(config);
  assert.equal(missing.found, false); assert.equal(missing.pythonSupported, true);
  assert.equal(missing.interpreter, interpreter);
  assert.match(missing.installCommand, /debugpy==1\.8\.17/);
  assert.equal(fs.existsSync(path.join(dir, 'SHOULD_NOT_EXIST')), false);
  const installed = await setup.install(config);
  assert.equal(installed.status.compatible, true); assert.equal(installed.status.version, '1.8.17');
  assert.match(installed.output, /Successfully installed debugpy/);
  assert.equal((await setup.check(config)).found, true);
  assert.match((await setup.install(config)).output, /already found/);
  assert.equal((await setup.check({ ...config, interpreter: basePython })).compatible, true);
  const override = path.join(dir, 'old-debugger'); fs.mkdirSync(override); fs.mkdirSync(path.join(override, 'debugpy'));
  fs.writeFileSync(path.join(override, 'debugpy/__init__.py'), '__version__ = "1.7.0"\n');
  const old = await setup.check({ ...config, env: { PYTHONPATH: override } });
  assert.equal(old.found, true); assert.equal(old.compatible, false); assert.equal(old.version, '1.7.0');
  await assert.rejects(setup.check({ ...config, interpreter: '/missing/python' }), /check|not found|No such file/);
  await assert.rejects(setup.check({ ...config, type: 'shell' }), /Python configurations only/);
  // Named manager activation resolves its interpreter before calling pip.
  const shim = path.join(dir, 'pyenv-shim');
  fs.writeFileSync(shim, '#!/bin/bash\n[ "$1" = exec ] || exit 9\nshift\nexport PATH=' + quote(envPath + '/bin') + ':$PATH\nexec "$@"\n'); fs.chmodSync(shim, 0o755);
  const managed = await setup.check({ ...config, manager: 'pyenv', environment: 'fixture-version', managerPath: shim, interpreter: 'python' });
  assert.equal(managed.interpreter, installed.status.interpreter);
  assert.equal(fs.existsSync(path.join(dir, 'SHOULD_NOT_EXIST')), false);
  // .env and setup exports follow run preparation without starting application.
  const dotenv = path.join(dir, '.env'); fs.writeFileSync(dotenv, 'PIP_NO_INDEX=1\n');
  const script = path.join(dir, 'prepare.sh');
  fs.writeFileSync(script, `echo once >> setup-count\nexport PIP_FIND_LINKS='${wheels}'\n`);
  await setup.check({ ...config, env: {}, envFiles: [dotenv], setupScripts: [{ path: script, shell: 'bash' }] });
  assert.equal(fs.readFileSync(path.join(dir, 'setup-count'), 'utf8').trim(), 'once');
  assert.deepEqual(manager.list(), []); assert.deepEqual(manager.configs.read(), []);
  // Real pip failure, then retry, in a separate empty environment.
  const failureEnv = path.join(dir, 'failure-env'); execFileSync(basePython, ['-m', 'venv', failureEnv]);
  const failed = { ...config, interpreter: path.join(failureEnv, 'bin/python'), env: { PIP_NO_INDEX: '1', PIP_FIND_LINKS: path.join(dir, 'absent-wheels') } };
  await assert.rejects(setup.install(failed), /debugpy installation failed/);
  assert.equal((await setup.install({ ...failed, env: config.env })).status.compatible, true);
  console.log(`PASS: ${host} selected interpreter, real install/recheck/idempotency, quoting, manager activation, environment sources, pip failure/retry, no application launch`);
}
(async () => {
  execFileSync(basePython, ['-m', 'pip', 'download', '--disable-pip-version-check', '--no-deps', '--dest', wheels, 'debugpy==1.8.17'], { stdio: 'pipe' });
  await verify('local', local);
  fixture = await createSshFixture(root); client = new Client();
  await new Promise((resolve, reject) => client.once('ready', resolve).once('error', reject).connect({ host: '127.0.0.1', port: fixture.port, username: 'fixture', password: 'fixture' }));
  await verify('ssh-fixture', ssh);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { client?.end(); fixture?.close(); fs.rmSync(root, { recursive: true, force: true }); });
