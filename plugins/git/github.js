const { createLibraryStore } = require('../../main/services/libraryStore');
const { randomUUID } = require('crypto');
const { quote } = require('../../main/services/hostCommands');
const { createContentCache } = require('./content-cache');
const MAX_CONTENT = 2 * 1024 * 1024;
function parseRemote(value) {
  let url;
  try { url = new URL(value.includes('://') ? value : value.replace(/^([^@]+@)?([^:]+):(.+)$/, 'ssh://$1$2/$3')); } catch { return null; }
  const repo = url.pathname.replace(/^\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-z0-9.-]+$/i.test(url.hostname)) return null;
  return { hostname: url.hostname, repo, owner: repo.split('/')[0], url: `https://${url.hostname}/${repo}`, ssh: url.protocol === 'ssh:' };
}
function createGitHub({ git, commands, getSettings = () => ({}), projectIdentity = id => id, root }) {
  const preferences = createLibraryStore('git-project-settings', root); const receipts = createLibraryStore('git-pr-receipts', root);
  const reviews = new Map(); const contents = createContentCache(); const defaultAccounts = new Map();
  const tokens = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];
  const executable = c => getSettings()?.git?.github?.paths?.value?.[c.host] || 'gh';
  const preferenceId = (c, repo) => JSON.stringify([projectIdentity(c.projectId) || c.cwd, c.host, repo.hostname]);
  async function invoke(c, repo, args, { account, input, raw = false } = {}) {
    const env = { GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', GH_NO_UPDATE_NOTIFIER: '1', GH_HOST: repo.hostname };
    account ??= preferences.read().find(p => p.id === preferenceId(c, repo))?.account || '';
    let command = { ...c, executable: executable(c), args, env, input };
    if (account) {
      if (!/^[a-z0-9_-]+$/i.test(account)) throw new Error('Invalid GitHub account');
      const tokenArgs = ['auth', 'token', '--hostname', repo.hostname, '--user', account];
      const tokenKey = repo.hostname === 'github.com' || repo.hostname.endsWith('.ghe.com') ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN';
      if (c.host === '__local__') {
        const result = await commands.run({ ...c, executable: executable(c), args: tokenArgs, unsetEnv: tokens });
        if (result.exitCode || !result.stdout.trim()) throw new Error('Cannot resolve the selected GitHub account. Check gh authentication.');
        command.env = { ...env, ...Object.fromEntries(tokens.map(name => [name, ''])), [tokenKey]: result.stdout.trim() };
      } else {
        // Resolve the credential on its host. Its value never enters a command argument or renderer payload.
        const script = `unset ${tokens.join(' ')}; marina_gh_token=$(${[executable(c), ...tokenArgs].map(quote).join(' ')}) || exit 1; export ${tokenKey}="$marina_gh_token"; exec ${[executable(c), ...args].map(quote).join(' ')}`;
        command = { ...c, executable: 'sh', args: ['-c', script], env, input };
      }
    }
    const result = await commands.run(command);
    if (result.exitCode) throw new Error(result.stderr.trim() || 'GitHub CLI failed');
    return raw ? result.stdout : JSON.parse(result.stdout || 'null');
  }
  async function remotes(contextId) {
    const c = git.context(contextId); const list = [];
    for (const name of (await git.text(c, ['remote'])).split('\n').filter(Boolean)) {
      const parsed = parseRemote((await git.text(c, ['remote', 'get-url', name])).trim());
      if (parsed?.ssh && parsed.hostname !== 'github.com') {
        try {
          const effective = await commands.run({ ...c, executable: 'ssh', args: ['-G', '--', parsed.hostname] });
          const hostname = /^hostname\s+([a-z0-9.-]+)\s*$/im.exec(effective.stdout)?.[1]?.toLowerCase();
          if (!effective.exitCode && hostname) { parsed.hostname = hostname === 'ssh.github.com' ? 'github.com' : hostname; parsed.url = `https://${parsed.hostname}/${parsed.repo}`; }
        } catch { /* A normal remote without an SSH alias still works without ssh -G. */ }
      }
      if (parsed) list.push({ name, ...parsed });
    }
    return list;
  }
  async function resolve(contextId, remote) {
    const c = git.context(contextId); const repo = (await remotes(contextId)).find(r => r.name === remote);
    if (!repo) throw new Error('Choose a GitHub remote'); return { c, repo };
  }
  async function status(contextId, remote) {
    const list = await remotes(contextId); const c = git.context(contextId); const repo = list.find(r => r.name === remote) || list[0];
    if (!repo) return { remotes: list, available: false, error: 'No supported GitHub remote found' };
    try {
      const version = await commands.run({ ...c, executable: executable(c), args: ['--version'] }); if (version.exitCode) throw new Error('GitHub CLI is unavailable');
      const auth = await invoke(c, repo, ['auth', 'status', '--hostname', repo.hostname, '--json', 'hosts'], { account: '' });
      const accounts = (auth.hosts?.[repo.hostname] || []).map(a => ({ login: a.login, active: Boolean(a.active), state: a.state, tokenSource: a.tokenSource }));
      defaultAccounts.set(preferenceId(c, repo), accounts.find(a => a.active)?.login || randomUUID());
      return { available: true, remotes: list, remote: repo.name, accounts, account: preferences.read().find(p => p.id === preferenceId(c, repo))?.account || '' };
    } catch (error) { return { available: false, remotes: list, remote: repo.name, error: `${error.message}. Check gh on this host or set its path in Settings.` }; }
  }
  async function selectAccount(contextId, remote, account) {
    const state = await status(contextId, remote); const { c, repo } = await resolve(contextId, remote);
    if (account && !state.accounts?.some(a => a.login === account)) throw new Error('Selected account is not authenticated on this host');
    preferences.upsert({ id: preferenceId(c, repo), account }); return {};
  }
  async function list(contextId, remote, query = '') {
    const { c, repo } = await resolve(contextId, remote);
    const args = ['pr', 'list', '--repo', `${repo.hostname}/${repo.repo}`, '--limit', '50', '--state', 'all', '--json', 'number,title,state,url,author,baseRefName,headRefName,isDraft'];
    if (query) args.push('--search', String(query).slice(0, 500));
    return { prs: await invoke(c, repo, args) };
  }
  async function review(contextId, remote, number) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR number');
    const { c, repo } = await resolve(contextId, remote); const prefix = ['api', '--hostname', repo.hostname];
    const account = preferences.read().find(p => p.id === preferenceId(c, repo))?.account || '';
    const authScope = account || `default:${defaultAccounts.get(preferenceId(c, repo)) || randomUUID()}`;
    const pr = await invoke(c, repo, [...prefix, `repos/${repo.repo}/pulls/${number}`], { account });
    // gh cannot combine --slurp with --jq. Compact each page before returning
    // it so large patch bodies do not consume the bounded IPC output budget.
    const [comparison, pages] = await Promise.all([
      invoke(c, repo, [...prefix, `repos/${repo.repo}/compare/${pr.base.sha}...${pr.head.sha}`, '--jq', '{merge_base_commit: .merge_base_commit}'], { account }),
      invoke(c, repo, [...prefix, '--paginate', `repos/${repo.repo}/pulls/${number}/files?per_page=100`, '--jq', 'map({filename,previous_filename,status,additions,deletions}) | @json'], { account, raw: true })
    ]);
    const files = pages.split(/\r?\n/).filter(line => line.trim()).flatMap(line => JSON.parse(line));
    if (files.length >= 3000) throw new Error('PR file list reached the GitHub API limit; open this PR in the browser for a complete review');
    const id = randomUUID();
    const data = { id, c, repo, account, authScope, base: comparison.merge_base_commit.sha, head: pr.head.sha, headRepo: pr.head.repo?.full_name, files };
    if (reviews.size >= 16) reviews.delete(reviews.keys().next().value); reviews.set(id, data);
    return { reviewId: id, number, title: pr.title, body: pr.body, state: pr.state, url: pr.html_url, author: pr.user.login, base: pr.base.ref, head: pr.head.ref,
      files: files.map((f, index) => ({ id: String(index), path: f.filename, oldPath: f.previous_filename || f.filename, status: f.status, added: f.additions, deleted: f.deletions })) };
  }
  async function content(reviewId, fileId) {
    const r = reviews.get(reviewId); const f = r?.files[Number(fileId)]; if (!f) throw new Error('PR review expired; reload it');
    function validate(text) {
      if (Buffer.byteLength(text) > MAX_CONTENT) throw new Error('PR file exceeds the 2 MB diff limit; open it in the browser');
      if (text.includes('\0') || text.includes('\ufffd')) throw new Error('Binary or non-UTF-8 PR file');
      return text;
    }
    async function local(sha, file) {
      // Block all Git transports too: older Git versions do not understand
      // GIT_NO_LAZY_FETCH. Missing partial-clone blobs must fall back to gh.
      // Filenames stay literal argv; cat-file receives a validated object ID.
      const run = (args, input) => commands.run({ ...r.c, executable: 'git', args: ['--no-pager', '--literal-pathspecs', ...args], input,
        env: { GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
      let tree;
      try { tree = await run(['ls-tree', '-l', '-z', sha, '--', file]); } catch { return null; }
      if (tree.exitCode) return null;
      const entry = /^(\d{6}) (blob|commit|tree) ([a-f0-9]{40,64}) +([0-9]+|-)\t/.exec(tree.stdout);
      if (!entry) return null;
      if (entry[2] !== 'blob') throw new Error('Submodule or directory PR content; open it in the browser');
      if (Number(entry[4]) > MAX_CONTENT) throw new Error('PR file exceeds the 2 MB diff limit; open it in the browser');
      let blob;
      try { blob = await run(['cat-file', 'blob', entry[3]]); } catch { return null; }
      if (blob.exitCode) return null;
      return validate(blob.stdout);
    }

    async function read(repo, sha, file) {
      if (!repo) throw new Error('PR head repository is unavailable');
      if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid PR commit');
      const key = JSON.stringify([r.c.host, r.c.identity, r.c.cwd, preferenceId(r.c, r.repo), r.authScope, executable(r.c), r.repo.hostname, repo, sha, file]);
      return contents.read(key, async () => {
        const text = await local(sha, file); if (text !== null) return text;
        const result = await invoke(r.c, r.repo, ['api', '--hostname', r.repo.hostname, `repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`], { account: r.account });
        if (result.type !== 'file' || result.encoding !== 'base64' || result.size > MAX_CONTENT) throw new Error('Binary, submodule, or oversized PR content; open it in the browser');
        return validate(Buffer.from(result.content, 'base64').toString('utf8'));
      });
    }
    try {
      if (r.c.identity && commands.identity?.(r.c.host) !== r.c.identity) throw new Error('Execution host settings changed. Refresh the repository context.');
      const [oldText, newText] = await Promise.all([f.status === 'added' ? '' : read(r.repo.repo, r.base, f.previous_filename || f.filename), f.status === 'removed' ? '' : read(r.headRepo, r.head, f.filename)]);
      return { name: f.filename, oldText, newText };
    }
    catch (error) { return { unavailable: error.message }; }
  }
  async function create(contextId, remote, input) {
    const { c, repo } = await resolve(contextId, remote);
    if (!/^[\w-]{1,100}$/.test(input.requestId || '')) throw new Error('PR request ID is required');
    if (!input.title?.trim() || input.title.length > 250 || typeof input.body !== 'string' || input.body.length > 30000) throw new Error('Enter a PR title and description');
    for (const branch of [input.head, input.base]) await git.text(c, ['check-ref-format', '--branch', branch]);
    const headRemote = (await remotes(contextId)).find(r => r.name === (input.headRemote || remote));
    if (!headRemote || headRemote.hostname !== repo.hostname) throw new Error('Select a head remote on the same GitHub host');
    const published = await git.text(c, ['ls-remote', '--exit-code', '--heads', headRemote.name, `refs/heads/${input.head}`]);
    const head = (await git.text(c, ['rev-parse', '--verify', 'HEAD'])).trim();
    if (published.split(/\s+/)[0] !== head) throw new Error('Push the current branch before creating a PR');
    const headLabel = `${headRemote.owner}:${input.head}`;
    const existing = await invoke(c, repo, ['pr', 'list', '--repo', `${repo.hostname}/${repo.repo}`, '--head', headLabel, '--base', input.base, '--state', 'open', '--json', 'url']);
    if (existing.length) return { url: existing[0].url, existing: true };
    const receiptId = JSON.stringify([c.host, repo.hostname, repo.repo, input.requestId]); const prior = receipts.read().find(r => r.id === receiptId);
    if (prior?.url) return { url: prior.url, existing: true };
    if (prior) throw new Error('A previous creation outcome is uncertain. Refresh PRs before submitting a new request.');
    receipts.upsert({ id: receiptId, state: 'pending' });
    const args = ['pr', 'create', '--repo', `${repo.hostname}/${repo.repo}`, '--head', headLabel, '--base', input.base, '--title', input.title, '--body-file', '-']; if (input.draft) args.push('--draft');
    const url = (await invoke(c, repo, args, { input: input.body, raw: true })).trim();
    if (!/^https:\/\//.test(url)) throw new Error('PR creation returned an unexpected result; refresh PRs');
    receipts.upsert({ id: receiptId, state: 'completed', url }); return { url };
  }
  async function branchUrl(contextId, remote, branch) {
    const { c, repo } = await resolve(contextId, remote); await git.text(c, ['check-ref-format', '--branch', branch]);
    const result = await git.text(c, ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`]);
    if (!result.trim()) throw new Error('This branch has not been published');
    return { url: `${repo.url}/tree/${encodeURIComponent(branch)}` };
  }
  return { status, selectAccount, list, review, content, create, branchUrl };
}
module.exports = { createGitHub, parseRemote };
