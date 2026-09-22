const { createLibraryStore } = require('../../main/services/libraryStore');
const fs = require('fs');
const { randomUUID } = require('crypto');

function migrateLegacyProfiles(legacy) {
  const records = Array.isArray(legacy) ? legacy
    : legacy && typeof legacy === 'object' ? Object.entries(legacy).flatMap(([host, profiles]) =>
      Array.isArray(profiles) ? profiles.filter(p => p && typeof p === 'object' && !Array.isArray(p)).map(p => ({ ...p, host })) : []) : [];
  const ids = new Set();
  return records.filter(p => p && typeof p === 'object' && !Array.isArray(p)).map(profile => {
    const id = typeof profile.id === 'string' && profile.id && !ids.has(profile.id) ? profile.id : randomUUID();
    ids.add(id);
    return { ...profile, id, name: typeof profile.name === 'string' && profile.name.trim() ? profile.name : `${profile.host || 'SSH'}:${profile.srcPort}`, autoStart: profile.autoStart === undefined ? true : Boolean(profile.autoStart) };
  });
}
function normalize(profile) {
  const port = value => { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Ports must be between 1 and 65535.'); return n; };
  if (!profile.name?.trim() || !profile.host || profile.host === '__local__') throw new Error('Enter a name and choose an SSH connection.');
  if (!['local', 'remote', 'dynamic'].includes(profile.type)) throw new Error('Choose a tunnel type.');
  if (profile.type !== 'dynamic' && (!profile.dstHost?.trim() || /[\s\0]/.test(profile.dstHost))) throw new Error('Enter a destination hostname.');
  return { id: profile.id, name: profile.name.trim(), host: profile.host, type: profile.type, autoStart: Boolean(profile.autoStart), srcPort: port(profile.srcPort), dstHost: profile.type === 'dynamic' ? '' : profile.dstHost.trim(), dstPort: profile.type === 'dynamic' ? null : port(profile.dstPort) };
}
function createTunnelManager({ sessionManager, resolveHost, root, legacy = [], tunnelService }) {
  const store = createLibraryStore('tunnel-profiles', root);
  if (!fs.existsSync(store.file)) store.write(migrateLegacyProfiles(legacy));
  const running = new Map(), pending = new Map();
  const sessionId = id => `tunnel-profile:${id}`;
  function list() {
    return store.read().map(profile => {
      const runtime = running.get(profile.id);
      if (runtime?.status === 'active' && tunnelService && !tunnelService.tunnels.has(runtime.tunnelId)) running.set(profile.id, { status: 'error', error: 'SSH connection closed. Start the profile to reconnect.' });
      return { ...profile, ...(running.get(profile.id) || { status: 'stopped' }) };
    });
  }
  async function stop(id) {
    if (pending.has(id)) await pending.get(id).catch(() => {});
    await sessionManager.disconnect(sessionId(id)); running.delete(id);
  }
  function start(id) {
    if (pending.has(id)) return pending.get(id);
    if (list().find(p => p.id === id)?.status === 'active') return Promise.resolve();
    const promise = (async () => {
      const raw = store.read().find(p => p.id === id); if (!raw) throw new Error('Tunnel profile not found.');
      const profile = normalize(raw); const host = resolveHost(profile.host); if (!host) throw new Error('SSH connection no longer exists.');
      running.set(id, { status: 'connecting' });
      try {
        await sessionManager.connectControl(sessionId(id), host, 'tunnel profile');
        const config = profile.type === 'remote' ? { remotePort: profile.srcPort, localHost: profile.dstHost, localPort: profile.dstPort } : { localPort: profile.srcPort, remoteHost: profile.dstHost, remotePort: profile.dstPort };
        const result = await sessionManager.createTunnel(sessionId(id), profile.type, config);
        running.set(id, { status: 'active', tunnelId: result.id });
      } catch (error) { await sessionManager.disconnect(sessionId(id)); running.set(id, { status: 'error', error: error.message }); throw error; }
    })();
    pending.set(id, promise); promise.finally(() => pending.delete(id)).catch(() => {}); return promise;
  }
  return { list, start, stop,
    save: async profile => { const clean = normalize(profile); if (clean.id) await stop(clean.id); return store.upsert(clean); },
    remove: async id => { await stop(id); store.remove(id); },
    shutdown: async () => { await Promise.allSettled([...new Set([...running.keys(), ...pending.keys()])].map(stop)); }
  };
}
module.exports = { normalize, createTunnelManager };
