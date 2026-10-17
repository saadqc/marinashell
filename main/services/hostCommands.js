const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { resolveHost } = require('./sshConfig');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const MAX_BYTES = 8 * 1024 * 1024;
function createHostCommands(sessionManager, getSettings = () => ({})) {
  const connections = new Map();
  const identity = host => host === '__local__' ? 'local' : createHash('sha256').update(JSON.stringify(resolveHost(host, () => {}) || null)).digest('hex');
  async function run({ host = '__local__', identity: expectedIdentity, cwd, executable, args = [], env = {}, unsetEnv = [], input, timeoutMs = 20000 }) {
    if (expectedIdentity && expectedIdentity !== identity(host)) throw new Error('Execution host settings changed. Refresh the repository context.');
    if (![executable, cwd, ...args, ...Object.keys(env), ...Object.values(env)].every(v => typeof v === 'string' && !v.includes('\0'))) throw new Error('Invalid command arguments');
    if (host === '__local__') {
      const directory = cwd === '~' ? os.homedir() : cwd.startsWith('~/') ? path.join(os.homedir(), cwd.slice(2)) : cwd;
      const prepend = getSettings()?.shell?.local?.pathPrepend?.value || '';
      const environment = { ...process.env, PATH: [prepend, process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(path.delimiter), ...env };
      for (const name of unsetEnv) delete environment[name];
      return new Promise((resolve, reject) => { const child = execFile(executable, args, { cwd: directory, env: environment, timeout: timeoutMs, maxBuffer: MAX_BYTES, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        if (error && !Number.isInteger(error.code)) return reject(new Error(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'Command output exceeds 8 MB' : error.message));
        resolve({ stdout, stderr, exitCode: error?.code || 0 });
      }); child.stdin.on('error', () => {}); child.stdin.end(input); });
    }
    const id = `tool-control:${host}:${identity(host).slice(0, 12)}`;
    if (!connections.has(id)) {
      const config = resolveHost(host, () => {}); if (!config) throw new Error('SSH host not found');
      const pending = sessionManager.connectControl(id, config); connections.set(id, pending); pending.catch(() => connections.delete(id));
    }
    await connections.get(id);
    if (!Object.keys(env).every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error('Invalid environment key');
    const directory = cwd === '~' ? '"$HOME"' : cwd.startsWith('~/') ? `"$HOME"/${quote(cwd.slice(2))}` : quote(cwd);
    const command = `cd -- ${directory} && env ${Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join(' ')} ${[executable, ...args].map(quote).join(' ')}`;
    try { return await sessionManager.exec(id, command, { timeoutMs, maxBytes: MAX_BYTES, input }); }
    catch (error) { connections.delete(id); throw error; }
  }
  return { run, identity };
}
module.exports = { createHostCommands, quote, MAX_BYTES };
