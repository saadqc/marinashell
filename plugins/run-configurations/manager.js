const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { StringDecoder } = require('string_decoder');
const { createLibraryStore } = require('../../main/services/libraryStore');
const { normalize, quote, pathExpression, buildCommand, parseEnv } = require('./configuration');
const runner = fs.readFileSync(path.join(__dirname, 'runner.sh'), 'utf8');
const ended = run => ['exited', 'blocked', 'failed'].includes(run.status);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRunManager({ execute, hostIdentity, tmuxAvailable = () => false, root }) {
  const configs = createLibraryStore('run-configurations', root);
  const records = createLibraryStore('run-records', root);
  const runs = new Map(records.read().map(run => [run.id, run]));
  const launching = new Map();
  const decoders = new Map();
  const saveRuns = () => records.write([...runs.values()]);
  const runPath = run => `${run.home}/.marinashell/runs/${run.id}`;
  async function command(host, text, options) {
    const result = await execute(host, text, options);
    if (result.exitCode !== 0 && result.exitCode !== null) throw new Error((result.stderr || result.stdout || `Command failed (${result.exitCode})`).trim());
    return result.stdout || '';
  }
  async function verifyHost(run) {
    if (run.hostIdentity !== await hostIdentity(run.host)) throw new Error('SSH host settings changed since this run started; select the original host before controlling it.');
  }
  async function inspect(run, offset = 0, generation = 0, decode = true) {
    await verifyHost(run);
    const stdout = await command(run.host, `bash ${quote(runPath(run) + '/runner.sh')} status ${quote(runPath(run))} ${Math.max(0, Number(offset) || 0)} ${Math.max(0, Number(generation) || 0)}`);
    const parts = stdout.split('\n');
    const previous = run.status;
    run.status = parts[0] || 'unknown';
    run.exitCode = parts[1]?.trim() ? Number(parts[1]) : null;
    run.supervisorPid = Number(parts[2]) || null;
    run.pid = Number(parts[3]) || null;
    run.processGroupId = run.pid;
    run.supervisorStartTime = parts[4]?.trim() || '';
    run.processStartTime = parts[5]?.trim() || '';
    run.bootIdentity = parts[6]?.trim() || '';
    const nextGeneration = Number(parts[7]) || 0;
    const size = Number(parts[8]) || 0;
    const reset = nextGeneration !== generation || offset > size;
    const buffer = Buffer.from(parts.slice(9).join(''), 'base64');
    let decoder = decode ? decoders.get(run.id) : null;
    if (!decoder || offset === 0 || reset) decoder = new StringDecoder('utf8');
    const output = decode ? decoder.write(buffer) : '';
    if (decode) decoders.set(run.id, decoder);
    run.error = ''; run.checkedAt = new Date().toISOString();
    if (run.status !== previous) saveRuns();
    return { run: { ...run }, output, offset: (reset ? 0 : offset) + buffer.length, generation: nextGeneration, reset, hasMore: (reset ? 0 : offset) + buffer.length < size };
  }
  async function poll(id, offset, generation) {
    const run = runs.get(id); if (!run) throw new Error('Run not found');
    try { return await inspect(run, offset, generation); }
    catch (error) {
      run.status = 'unknown'; run.error = error.message;
      return { run: { ...run }, output: '', offset, generation };
    }
  }
  async function refresh(run) { await inspect(run, 0, 0, false); return run; }
  async function findExisting(config) {
    for (const run of runs.values()) {
      if (run.configurationId !== config.id || ended(run)) continue;
      await refresh(run); // Unknown is blocking, never an implicit new launch.
      if (!ended(run)) return run;
    }
    return null;
  }
  async function start(id, groupId = '', groupName = '') {
    if (launching.has(id)) {
      const pending = launching.get(id);
      const c = configs.read().find(item => item.id === id);
      if (!c?.multiInstance) return pending;
      await pending; return start(id, groupId, groupName);
    }
    const operation = (async () => {
      const stored = configs.read().find(item => item.id === id);
      if (!stored) throw new Error('Save the configuration before running it');
      const config = normalize(stored);
      if (!config.multiInstance) {
        const existing = await findExisting(config);
        if (existing) return { ...existing, reused: true };
      }
      return launch(config, groupId, groupName);
    })();
    launching.set(id, operation);
    try { return await operation; } finally { launching.delete(id); }
  }
  async function launch(config, groupId, groupName) {
    const c = normalize(config);
    if (c.host === '__local__' && process.platform === 'win32') throw new Error('Native Windows execution is not supported; select a macOS/Linux SSH host with Bash.');
    if (c.tmux && !tmuxAvailable()) throw new Error('Install and enable the tmux plugin before using tmux execution');
    const home = (await command(c.host, 'printf "%s" "$HOME"')).trim();
    if (!home.startsWith('/')) throw new Error('Run configurations require a POSIX host with Bash (macOS or Linux).');
    await command(c.host, 'command -v bash >/dev/null || { echo "Bash is required on the execution host" >&2; exit 1; }');
    if (c.tmux) await command(c.host, 'command -v tmux >/dev/null || { echo "tmux is not installed on the SSH host" >&2; exit 1; }');
    let fileEnv = {};
    for (const file of c.envFiles) {
      const content = await command(c.host, `cd -- ${pathExpression(c.cwd)} && cat -- ${pathExpression(file)}`);
      fileEnv = { ...fileEnv, ...parseEnv(content) };
    }
    const run = {
      id: randomUUID(), configurationId: c.id, name: c.name, host: c.host, cwd: c.cwd,
      hostIdentity: await hostIdentity(c.host), home, groupId, groupName,
      tmux: c.tmux, multiInstance: c.multiInstance, tmuxSession: c.tmuxSession || `marina-${c.id.slice(0, 12)}`,
      startedAt: new Date().toISOString(), status: 'starting', exitCode: null, closed: false,
      instance: 1 + [...runs.values()].filter(item => item.configurationId === c.id).length
    };
    const dir = runPath(run);
    const locks = `${home}/.marinashell/run-locks`;
    const lock = c.multiInstance ? '' : `${locks}/${createHash('sha256').update(c.id).digest('hex')}`;
    // Recover an ended lock after a crash between exit recording and cleanup.
    if (lock) {
      const previousPath = (await command(c.host, `cat ${quote(lock + '/run')} 2>/dev/null || true`)).trim();
      if (previousPath) {
        const match = /\/([a-f0-9-]{36})$/.exec(previousPath);
        if (!match || previousPath !== `${home}/.marinashell/runs/${match[1]}`) throw new Error('Single-instance lock has an invalid owner');
        const status = (await command(c.host, `bash ${quote(previousPath + '/runner.sh')} status ${quote(previousPath)} 0 0`)).split('\n')[0];
        if (status === 'exited' || status === 'blocked') await command(c.host, `rm -f ${quote(lock + '/run')} && rmdir ${quote(lock)}`);
        else throw new Error('This configuration already has a remote run. Reconnect to its existing output tab before starting another instance.');
      }
    }
    await command(c.host, `umask 077; mkdir -p ${quote(dir)} ${quote(locks)} && printf '%s' ${quote(runner)} > ${quote(dir + '/runner.sh')} && printf '%s' ${quote(buildCommand(c, fileEnv))} > ${quote(dir + '/command.sh')}`);
    runs.set(run.id, run); saveRuns();
    const launchCommand = `bash ${quote(dir + '/runner.sh')} run ${quote(dir)} ${quote(lock)}`;
    try {
      if (c.tmux) {
        // Exact session targets; never inject commands into a pre-existing pane.
        const exists = await execute(c.host, `tmux has-session -t ${quote('=' + run.tmuxSession)}`);
        const tmuxCommand = exists.exitCode === 0
          ? `tmux new-window -d -P -F '#{session_id}|#{window_id}|#{pane_id}' -t ${quote(run.tmuxSession + ':')} -n ${quote(`run-${run.id.slice(0, 8)}`)} ${quote(launchCommand)}`
          : `tmux new-session -d -P -F '#{session_id}|#{window_id}|#{pane_id}' -s ${quote(run.tmuxSession)} -n ${quote(`run-${run.id.slice(0, 8)}`)} ${quote(launchCommand)}`;
        const ids = (await command(c.host, tmuxCommand)).trim().split('|');
        [run.tmuxSessionId, run.tmuxWindowId, run.tmuxPaneId] = ids;
      } else {
        // Deliberately keep the command channel open. tmux is the explicit
        // persistence option; a broken channel never implies confirmed exit.
        execute(c.host, launchCommand, { timeoutMs: 0 }).then(() => refresh(run)).catch(error => {
          if (!ended(run)) { run.status = 'unknown'; run.error = error.message; saveRuns(); }
        });
      }
      for (let i = 0; i < 30; i++) {
        await delay(100);
        try { await refresh(run); } catch (_) { continue; }
        if (run.status !== 'unknown' && run.status !== 'starting') break;
      }
      saveRuns();
      return { ...run };
    } catch (error) { run.status = 'unknown'; run.error = error.message; saveRuns(); throw error; }
  }
  async function stop(id, force = false) {
    const run = runs.get(id); if (!run) throw new Error('Run not found');
    await refresh(run);
    if (ended(run)) return { ...run };
    if (run.status === 'unknown') throw new Error('Run owner cannot be verified. Reconnect and check status before stopping.');
    await command(run.host, `bash ${quote(runPath(run) + '/runner.sh')} control ${quote(runPath(run))} ${force || run.status === 'stopping' ? 'kill' : 'stop'}`);
    run.status = 'stopping'; saveRuns(); return { ...run };
  }
  async function restart(id) {
    const run = runs.get(id); if (!run) throw new Error('Run not found');
    await stop(id);
    for (let i = 0; i < 40; i++) {
      await delay(200); await refresh(run);
      if (ended(run)) return start(run.configurationId, run.groupId, run.groupName);
    }
    throw new Error('Process is still stopping. Press Stop again to force termination, then Run.');
  }
  async function close(id) {
    const run = runs.get(id); if (!run) return;
    await refresh(run);
    if (!ended(run)) throw new Error('The process has not stopped. The output tab must remain open.');
    run.closed = true; saveRuns();
  }
  async function shutdown() {
    await Promise.all([...runs.values()].filter(run => !run.tmux && !ended(run)).map(async run => {
      try {
        await stop(run.id); await delay(500); await refresh(run);
        if (!ended(run)) {
          await stop(run.id, true);
          for (let i = 0; i < 30 && !ended(run); i++) { await delay(100); await refresh(run); }
        }
      } catch (_) { /* Unknown records remain available on next launch. */ }
    }));
  }
  return { configs, list: () => [...runs.values()].filter(run => !run.closed), start, poll, stop, restart, close, shutdown, command };
}
module.exports = { createRunManager, ended };
