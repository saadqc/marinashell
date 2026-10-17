const { createHostCommands } = require('../../main/services/hostCommands');
const { createGitService } = require('./service');
const { installGitOperations } = require('./operations');
const { createGitHub } = require('./github');
module.exports = function activate({ sessionManager, getSettings, registerIpc, registerService, projectIdentity }) {
  const commands = createHostCommands(sessionManager, getSettings);
  const service = createGitService(commands);
  installGitOperations(service);
  const github = createGitHub({ git: service, commands, getSettings, projectIdentity });
  for (const [name, handler] of Object.entries({ 'github-status': p => github.status(p.contextId, p.remote), 'github-account': p => github.selectAccount(p.contextId, p.remote, p.account), 'github-list': p => github.list(p.contextId, p.remote, p.query), 'github-review': p => github.review(p.contextId, p.remote, p.number), 'github-content': p => github.content(p.reviewId, p.fileId), 'github-create': p => github.create(p.contextId, p.remote, p.input), 'github-branch-url': p => github.branchUrl(p.contextId, p.remote, p.branch) })) {
    registerIpc(name, async (_event, payload = {}) => { try { return { ok: true, ...(await handler(payload)) }; } catch (error) { return { ok: false, error: error.message }; } });
  }
  registerService('git', service);
  for (const [name, handler] of Object.entries({ discover: p => service.discover(p), snapshot: p => service.snapshot(p.contextId, p.base), content: p => service.content(p.snapshotId, p.fileId), operation: p => service.operation(p.snapshotId, p.action, p.payload), remotes: async p => ({ remotes: (await service.text(service.context(p.contextId), ['remote'])).split('\n').filter(Boolean) }) })) {
    registerIpc(name, async (_event, payload = {}) => { try { return { ok: true, ...(await handler(payload)) }; } catch (error) { return { ok: false, error: error.message }; } });
  }
};
