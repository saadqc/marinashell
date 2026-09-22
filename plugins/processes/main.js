const fs = require('fs');
const path = require('path');
const { resolveHost } = require('../../main/services/sshConfig');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
module.exports = ({ registerIpc, registerShutdown, registerService, sessionManager }) => {
  const source = fs.readFileSync(path.join(__dirname, 'collect.py'), 'utf8');
  const connections = new Map();
  const pending = new Map();
  async function snapshot(host) {
    if (pending.has(host)) return pending.get(host);
    const work = (async () => {
      const id = `process-control:${host}`;
      if (!connections.has(host)) {
        const config = host === '__local__' ? null : resolveHost(host, () => {});
        if (host !== '__local__' && !config) throw new Error('SSH host not found.');
        await sessionManager.connectControl(id, config, 'process list');
        connections.set(host, id);
      }
      const result = await sessionManager.exec(id, `command -v python3 >/dev/null || { echo 'Process list requires Python 3 on this host.' >&2; exit 1; }; python3 -c ${quote(source)}`, { timeoutMs: 25000 });
      if (result.exitCode) throw new Error((result.stderr || 'Process collection failed.').trim());
      return JSON.parse(result.stdout);
    })();
    pending.set(host, work);
    try { return await work; }
    catch (error) { connections.delete(host); await sessionManager.disconnect(`process-control:${host}`); throw error; }
    finally { pending.delete(host); }
  }
  registerService?.('processes', { list: snapshot });
  registerIpc('list', async (_event, payload = {}) => {
    try { return { ok: true, ...(await snapshot(String(payload.host || '__local__'))) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  const stopSource = fs.readFileSync(path.join(__dirname, 'stop.py'), 'utf8');
  registerIpc('stop', async (_event, payload = {}) => {
    try {
      if (!Number.isSafeInteger(payload.pid) || payload.pid <= 1 || typeof payload.identity !== 'string' || !payload.identity) throw new Error('Invalid process identity.');
      const host = String(payload.host || '__local__');
      await snapshot(host);
      const result = await sessionManager.exec(connections.get(host), `python3 -c ${quote(stopSource)} ${quote(JSON.stringify({pid:payload.pid,identity:payload.identity,force:payload.force === true}))}`, {timeoutMs:10000});
      if (result.exitCode) throw new Error((result.stderr || 'Could not stop process.').trim());
      return JSON.parse(result.stdout);
    } catch (error) { return {ok:false,error:error.message}; }
  });
  registerShutdown(async () => { await Promise.allSettled([...pending.values()]); for (const id of connections.values()) await sessionManager.disconnect(id); });
};
