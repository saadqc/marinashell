const os = require('os');
const path = require('path');
const { dialog } = require('electron');
const { resolveHost } = require('../../main/services/sshConfig');
const { createRunManager } = require('./manager');
const { normalize, quote, pathExpression } = require('./configuration');

module.exports = function activate({ sessionManager, registerIpc, getPlugins, getMainWindow, registerShutdown }) {
  const connections = new Map();
  const tmuxAvailable = () => getPlugins().some(plugin => plugin.id === 'tmux' && plugin.enabled && plugin.loaded && !plugin.error);
  function resolved(host) {
    if (host === '__local__') return null;
    const config = resolveHost(host, () => {});
    if (!config) throw new Error(`Host not found in SSH config: ${host}`);
    return config;
  }
  async function execute(host, command, options) {
    const tabId = `run-control:${host}`;
    if (!connections.has(host)) {
      const pending = sessionManager.connectControl(tabId, resolved(host));
      connections.set(host, pending);
      pending.catch(() => connections.delete(host));
    }
    await connections.get(host);
    try { return await sessionManager.exec(tabId, command, options); }
    catch (error) { connections.delete(host); throw error; }
  }
  const manager = createRunManager({
    execute, tmuxAvailable,
    hostIdentity: async host => host === '__local__' ? `local:${os.hostname()}:${os.userInfo().username}` : JSON.stringify(resolved(host))
  });
  registerShutdown(manager.shutdown);
  function ipc(name, handler) {
    registerIpc(name, async (_event, payload = {}) => {
      try { return { ok: true, ...(await handler(payload)) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }
  ipc('list', async () => ({ configurations: manager.configs.read(), runs: manager.list(), tmuxAvailable: tmuxAvailable() }));
  ipc('save', async ({ configuration }) => ({ configuration: manager.configs.upsert(normalize(configuration)) }));
  ipc('delete', async ({ id }) => {
    if (manager.list().some(run => run.configurationId === id && !['exited', 'failed', 'blocked'].includes(run.status))) throw new Error('Stop this configuration’s runs before deleting it');
    manager.configs.remove(id); return {};
  });
  ipc('start', async ({ id, groupId, groupName }) => ({ run: await manager.start(id, groupId, groupName) }));
  ipc('poll', async ({ id, offset = 0, generation = 0 }) => manager.poll(id, offset, generation));
  ipc('stop', async ({ id, force }) => ({ run: await manager.stop(id, force) }));
  ipc('restart', async ({ id }) => ({ run: await manager.restart(id) }));
  ipc('close', async ({ id }) => { await manager.close(id); return {}; });
  ipc('browse', async ({ host = '__local__', directory = '~', kind = 'file' }) => {
    if (host === '__local__') {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        defaultPath: directory.startsWith('~/') ? path.join(os.homedir(), directory.slice(2)) : directory === '~' ? os.homedir() : directory,
        properties: [kind === 'directory' ? 'openDirectory' : 'openFile', 'showHiddenFiles']
      });
      return { path: result.canceled ? '' : result.filePaths[0] };
    }
    const output = await manager.command(host, `cd -- ${pathExpression(directory)} && printf '%s\\n' "$PWD" && for item in * .[!.]* ..?*; do [ -e "$item" ] || continue; if [ -d "$item" ]; then printf 'd '; else printf 'f '; fi; printf '%s' "$item" | base64 | tr -d '\\n'; printf '\\n'; done`);
    const lines = output.split('\n');
    return { directory: lines.shift(), entries: lines.filter(Boolean).map(line => ({ directory: line[0] === 'd', name: Buffer.from(line.slice(2), 'base64').toString('utf8') })) };
  });
  ipc('env-read', async ({ host, file, cwd = '~' }) => {
    const content = await manager.command(host, `cd -- ${pathExpression(cwd)} && head -c 1048577 -- ${pathExpression(file)}`);
    if (Buffer.byteLength(content) > 1048576) throw new Error('Environment file exceeds 1 MB');
    return { content };
  });
  ipc('env-create', async ({ host, file, content, cwd = '~' }) => {
    if (!String(file || '').trim()) throw new Error('Environment file path is required');
    if (Buffer.byteLength(String(content)) > 1048576) throw new Error('Environment file exceeds 1 MB');
    // noclobber makes Create safe even if the file appeared after browsing.
    await manager.command(host, `umask 077; cd -- ${pathExpression(cwd)} && (set -C; printf '%s' ${quote(content)} > ${pathExpression(file)})`);
    return {};
  });
  ipc('discover', async ({ host = '__local__', type = 'python' }) => {
    const runtimes = []; const warnings = [];
    const cmd = `for tool in python python3 node bash zsh conda mamba micromamba pyenv; do p=$(command -v "$tool" 2>/dev/null) || continue; [ -f "$p" ] && printf '%s\\t%s\\n' "$tool" "$p"; done
for p in "$HOME"/.pyenv/versions/*/bin/python "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/miniconda3/bin/conda "$HOME"/miniforge3/bin/conda "$HOME"/mambaforge/bin/mamba "$HOME"/.local/bin/micromamba "$HOME"/.pyenv/bin/pyenv /opt/homebrew/bin/micromamba /opt/homebrew/bin/conda; do [ -x "$p" ] && printf 'detected\\t%s\\n' "$p"; done
true`;
    const lines = (await manager.command(host, cmd)).split('\n').filter(Boolean).map(line => line.split('\t'));
    const seen = new Set();
    for (const [name, executable] of lines) {
      if (!executable || seen.has(executable)) continue; seen.add(executable);
      const basename = path.posix.basename(executable);
      if (['conda', 'mamba', 'micromamba'].includes(basename)) {
        if (type !== 'python') continue;
        try {
          const result = JSON.parse(await manager.command(host, `${quote(executable)} env list --json`));
          for (const env of result.envs || []) runtimes.push({ label: `${basename} · ${path.posix.basename(env)}`, manager: basename, managerPath: executable, environment: env, interpreter: `${env}/bin/python` });
        } catch (error) { warnings.push(`${basename}: ${error.message}`); }
      } else if (basename === 'pyenv') {
        if (type !== 'python') continue;
        try {
          const versions = (await manager.command(host, `${quote(executable)} versions --bare`)).split('\n').filter(Boolean);
          for (const version of versions) runtimes.push({ label: `pyenv · ${version}`, manager: 'pyenv', managerPath: executable, environment: version, interpreter: 'python' });
        } catch (error) { warnings.push(`pyenv: ${error.message}`); }
      } else if (type === 'python' && /^python/.test(basename)) {
        runtimes.push({ label: executable, manager: 'system', environment: '', interpreter: executable });
      } else if (type === 'javascript' && basename === 'node') {
        const nvm = /^(.*\/\.nvm)\/versions\/node\/([^/]+)\/bin\/node$/.exec(executable);
        runtimes.push({ label: nvm ? `nvm · ${nvm[2]}` : executable, manager: nvm ? 'nvm' : 'system', managerPath: nvm ? `${nvm[1]}/nvm.sh` : '', environment: nvm ? nvm[2] : '', interpreter: executable });
      } else if (type === 'shell' && ['bash', 'zsh'].includes(basename)) runtimes.push({ label: executable, manager: 'system', interpreter: executable, environment: '' });
    }
    let tmuxSessions = [];
    if (host !== '__local__' && tmuxAvailable()) {
      const result = await execute(host, "tmux list-sessions -F '#{session_name}' 2>/dev/null");
      if (result.exitCode === 0) tmuxSessions = result.stdout.trim().split('\n').filter(Boolean);
    }
    return { runtimes, warnings, tmuxSessions, tmuxAvailable: tmuxAvailable() };
  });
};
