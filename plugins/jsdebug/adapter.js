const fs = require('fs'); const os = require('os'); const path = require('path'); const { randomUUID, createHash } = require('crypto');
const { spawn } = require('child_process'); const tar = require('tar');
const VERSION = '1.140.0';
const SHA256 = '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968';
const URL = `https://github.com/microsoft/vscode-js-debug/releases/download/v${VERSION}/js-debug-dap-v${VERSION}.tar.gz`;
function createAdapter({ root = path.join(os.homedir(), '.marinashell'), settings = () => ({}) } = {}) {
  const directory = path.join(root, 'debug-adapters', 'js-debug', VERSION); let installing; let starting; let child; let port;
  function entry() { return settings().adapterPath || path.join(directory, 'js-debug', 'src', 'dapDebugServer.js'); }
  function status() { return { installed: fs.existsSync(entry()), path: entry(), version: VERSION, nodePath: settings().nodePath || process.execPath, customAdapterPath: settings().adapterPath || '', customNodePath: settings().nodePath || '', source: URL }; }
  async function install(archive) {
    if (installing) return installing;
    installing = (async () => {
      if (settings().adapterPath) throw new Error('Clear the custom adapter path before installing the bundled version');
      const temporary = directory + '.' + randomUUID(); await fs.promises.mkdir(temporary, { recursive: true, mode: 0o700 });
      try {
        let data;
        if (archive) data = await fs.promises.readFile(archive);
        else {
          const response = await fetch(URL, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Adapter download failed (${response.status})`);
          const chunks = []; let size = 0;
          for await (const chunk of response.body) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('Adapter archive exceeds the size limit'); chunks.push(chunk); }
          data = Buffer.concat(chunks);
        }
        if (createHash('sha256').update(data).digest('hex') !== SHA256) throw new Error('Adapter archive integrity check failed');
        const file = path.join(temporary, 'adapter.tar.gz'); await fs.promises.writeFile(file, data, { mode: 0o600 });
        await tar.x({ file, cwd: temporary, strict: true, preservePaths: false });
        await fs.promises.unlink(file);
        if (!fs.existsSync(path.join(temporary, 'js-debug', 'src', 'dapDebugServer.js'))) throw new Error('Adapter archive is incomplete');
        await fs.promises.mkdir(path.dirname(directory), { recursive: true });
        if (!fs.existsSync(directory)) await fs.promises.rename(temporary, directory);
        return status();
      } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
    })();
    try { return await installing; } finally { installing = null; }
  }
  async function start() {
    if (port && child && child.exitCode === null) return port;
    if (starting) return starting;
    if (!status().installed) throw new Error('Install the JavaScript debug adapter from JSDebug → Debugger setup / Attach');
    starting = new Promise((resolve, reject) => {
      child = spawn(settings().nodePath || process.execPath, [entry(), '0', '127.0.0.1'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = ''; let errorOutput = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('JavaScript adapter startup timed out')); }, 15000);
      child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-2000); });
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-2000); const match = /Debug server listening at 127\.0\.0\.1:(\d+)/.exec(output); if (match) { port = Number(match[1]); clearTimeout(timer); resolve(port); } });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); port = null; reject(new Error(errorOutput || 'JavaScript debug adapter exited')); });
    });
    try { return await starting; } finally { starting = null; }
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const owned = child; await new Promise(resolve => { const timer = setTimeout(() => { owned.kill('SIGKILL'); }, 3000); owned.once('exit', () => { clearTimeout(timer); resolve(); }); owned.kill(); }); child = null; port = null;
  }
  return { status, install, start, stop };
}
module.exports = { createAdapter, VERSION, SHA256 };
