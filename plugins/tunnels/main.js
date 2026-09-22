const { createTunnelManager } = require('./manager');
const { resolveHost } = require('../../main/services/sshConfig');
const { loadState } = require('../../main/services/stateStore');
const tunnelService = require('../../main/services/tunnelService');
module.exports = context => {
  const manager = createTunnelManager({ sessionManager: context.sessionManager, resolveHost, legacy: loadState().tunnelProfiles || [], tunnelService });
  for (const action of ['list', 'save', 'remove', 'start', 'stop']) context.registerIpc(action, async (_event, payload) => {
    try { return { ok: true, data: await manager[action](payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  context.registerShutdown(() => manager.shutdown());
};
