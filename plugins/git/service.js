const { randomUUID, createHash } = require('crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_CONTENT = 2 * 1024 * 1024;
function parseNames(text, scope) {
  const fields = text.split('\0'); const rows = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++]; const oldPath = fields[i++];
    const path = /^[RC]/.test(status) ? fields[i++] : oldPath;
    rows.push({ id: `${scope}:${rows.length}`, scope, status, path, oldPath });
  }
  return rows;
}
function parseStats(text) {
  const fields = text.split('\0'); const result = new Map();
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const record = fields[i]; const first = record.indexOf('\t'); const second = record.indexOf('\t', first + 1);
    const added = record.slice(0, first); const deleted = record.slice(first + 1, second); let name = record.slice(second + 1);
    if (!name) { i++; name = fields[++i]; }
    result.set(name, { added: added === '-' ? null : Number(added), deleted: deleted === '-' ? null : Number(deleted) });
  }
  return result;
}
function createGitService(commands) {
  const contexts = new Map(); const snapshots = new Map(); const locks = new Set();
  async function git(c, args, allowFailure = false) {
    if (c.identity && commands.identity?.(c.host) !== c.identity) throw new Error('SSH host settings changed. Refresh the Git repository context.');
    const result = await commands.run({ ...c, executable: 'git', args: ['--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=false', ...args], env: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
    if (result.exitCode && !allowFailure) throw new Error(result.stderr.trim() || 'Git command failed');
    return result;
  }
  const text = async (c, args, allowFailure = false) => (await git(c, args, allowFailure)).stdout;
  function context(id) { const c = contexts.get(id); if (!c) throw new Error('Repository context expired. Refresh the Git view.'); return c; }
  async function discover(input) {
    const c = { host: input.host || '__local__', cwd: input.cwd, tabId: input.tabId || '', projectId: input.projectId || '' };
    c.identity = commands.identity?.(c.host);
    const result = await git(c, ['rev-parse', '--show-toplevel'], true);
    if (result.exitCode) { if (/not a git repository|must be run in a work tree/i.test(result.stderr)) return { repository: null }; throw new Error(result.stderr || 'Cannot inspect Git directory'); }
    c.cwd = result.stdout.replace(/\r?\n$/, '');
    c.id = [...contexts.values()].find(existing => ['host', 'cwd', 'tabId', 'projectId', 'identity'].every(key => existing[key] === c[key]))?.id || randomUUID();
    if (contexts.size >= 100) contexts.delete(contexts.keys().next().value);
    contexts.set(c.id, c); return { repository: { ...c } };
  }
  async function fingerprint(c) {
    const [status, head, index, branch, changed] = await Promise.all([
      text(c, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      text(c, ['rev-parse', '--verify', 'HEAD'], true),
      text(c, ['ls-files', '--stage', '-z']),
      text(c, ['symbolic-ref', '--quiet', 'HEAD'], true),
      text(c, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--'])
    ]);
    const untracked = (await text(c, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    const hashes = [];
    const paths = [...new Set([...changed.split('\0').filter(Boolean), ...untracked])];
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      if (c.host === '__local__') {
        const fs = require('fs'); const path = require('path'); const files = [];
        for (const file of batch) {
          const absolute = path.join(c.cwd, file); const stat = await fs.promises.lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (!stat) hashes.push(`deleted:${file}`);
          else if (stat.isSymbolicLink()) hashes.push(hash(await fs.promises.readlink(absolute)));
          else if (stat.isDirectory()) hashes.push(await text(c, ['-C', file, 'rev-parse', '--verify', 'HEAD'], true));
          else files.push(file);
        }
        if (files.length) hashes.push(await text(c, ['hash-object', '--no-filters', '--', ...files]));
      } else {
        const script = 'for marina_file do if [ -L "$marina_file" ]; then readlink -n "$marina_file" | git hash-object --stdin || exit; elif [ -d "$marina_file" ]; then git -C "$marina_file" rev-parse HEAD || exit; elif [ -e "$marina_file" ]; then git hash-object --no-filters -- "$marina_file" || exit; else printf "deleted\\n"; fi; done';
        const result = await commands.run({ ...c, executable: 'sh', args: ['-c', script, 'marina-hash', ...batch] });
        if (result.exitCode) throw new Error(result.stderr || 'Cannot hash changed files'); hashes.push(result.stdout);
      }
    }
    return hash(JSON.stringify([status, head, branch, index, paths, hashes]));
  }
  async function snapshot(contextId, base = '') {
    const c = context(contextId); const before = await fingerprint(c);
    const head = (await text(c, ['rev-parse', '--verify', 'HEAD'], true)).trim();
    const branch = (await text(c, ['symbolic-ref', '--short', '-q', 'HEAD'], true)).trim() || 'Detached HEAD';
    const branches = (await text(c, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])).split('\n').filter(Boolean);
    const rows = []; let baseSha = '';
    if (base) {
      if (!branches.includes(base)) throw new Error('Select an existing branch');
      baseSha = (await text(c, ['merge-base', base, 'HEAD'])).trim();
    }
    for (const scope of base ? ['branch'] : ['staged', 'unstaged']) {
      const args = scope === 'branch' ? [baseSha, head] : scope === 'staged' ? ['--cached'] : [];
      const flags = ['--no-ext-diff', '--no-textconv', '-M'];
      const names = parseNames(await text(c, ['diff', ...flags, '--name-status', '-z', ...args, '--']), scope);
      const stats = parseStats(await text(c, ['diff', ...flags, '--numstat', '-z', ...args, '--']));
      rows.push(...names.map(row => ({ ...row, ...stats.get(row.path) })));
    }
    if (!base) for (const file of (await text(c, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)) {
      const stats = parseStats(await text(c, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--', '/dev/null', file], true));
      rows.push({ id: `untracked:${rows.length}`, scope: 'untracked', status: '?', path: file, oldPath: file, added: null, deleted: 0, ...[...stats.values()][0] });
    }
    if (before !== await fingerprint(c)) throw new Error('Repository changed while loading. Refresh to try again.');
    const snapshot = { id: randomUUID(), contextId, fingerprint: before, head, branch, branches, base, baseSha, files: rows };
    if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(snapshot.id, snapshot); return snapshot;
  }
  function getSnapshot(id) { const s = snapshots.get(id); if (!s) throw new Error('Diff snapshot expired. Refresh.'); return s; }
  async function content(snapshotId, fileId) {
    const s = getSnapshot(snapshotId); const c = context(s.contextId); const f = s.files.find(row => row.id === fileId);
    if (!f) throw new Error('Changed file not found');
    if (s.fingerprint !== await fingerprint(c)) throw new Error('Repository changed. Refresh before opening this diff.');
    if (f.status === 'U') return { unavailable: 'Unresolved merge conflict. Resolve it before comparing text.' };
    if ((await text(c, ['ls-files', '--stage', '-z', '--', f.path])).startsWith('160000')) return { unavailable: 'Submodule revision changed; text diff unavailable' };
    const references = [];
    if (f.status !== '?' && !f.status.startsWith('A')) references.push(f.scope === 'branch' ? `${s.baseSha}:${f.oldPath}` : f.scope === 'staged' ? `${s.head}:${f.oldPath}` : `:${f.oldPath}`);
    if (!f.status.startsWith('D') && ['branch', 'staged'].includes(f.scope)) references.push(f.scope === 'branch' ? `${s.head}:${f.path}` : `:${f.path}`);
    for (const reference of references) if (Number(await text(c, ['cat-file', '-s', reference])) > MAX_CONTENT) return { unavailable: 'File exceeds the 2 MB diff limit' };
    const show = async (revision, file) => {
      if (!revision) return '';
      const mode = await text(c, ['ls-tree', revision, '--', file]);
      if (mode.startsWith('160000')) throw new Error('Submodule changes are shown as metadata');
      return text(c, ['show', `${revision}:${file}`]);
    };
    const oldText = f.status === '?' || f.status.startsWith('A') ? '' : f.scope === 'branch' ? await show(s.baseSha, f.oldPath) : f.scope === 'staged' ? await show(s.head, f.oldPath) : await text(c, ['show', `:${f.oldPath}`]);
    let newText = '';
    if (!f.status.startsWith('D')) {
      if (f.scope === 'branch') newText = await show(s.head, f.path);
      else if (f.scope === 'staged') newText = await text(c, ['show', `:${f.path}`]);
      else {
        const file = c.cwd.replace(/\/$/, '') + '/' + f.path;
        if (c.host === '__local__') {
          const fs = require('fs'); const stat = await fs.promises.lstat(file);
          if (stat.size > MAX_CONTENT) return { unavailable: 'File exceeds the 2 MB diff limit' };
          newText = stat.isSymbolicLink() ? await fs.promises.readlink(file) : await fs.promises.readFile(file, 'utf8');
        } else {
          const { quote } = require('../../main/services/hostCommands');
          const result = await commands.run({ ...c, executable: 'sh', args: ['-c', `if [ -L ${quote(file)} ]; then readlink -n ${quote(file)}; else head -c ${MAX_CONTENT + 1} -- ${quote(file)}; fi`] });
          if (result.exitCode) throw new Error(result.stderr || 'Cannot read changed file'); newText = result.stdout;
        }
      }
    }
    if ([oldText, newText].some(t => Buffer.byteLength(t) > MAX_CONTENT)) return { unavailable: 'File exceeds the 2 MB diff limit' };
    if ([oldText, newText].some(t => t.includes('\0') || t.includes('\ufffd'))) return { unavailable: 'Binary or non-UTF-8 file; text diff unavailable' };
    if (s.fingerprint !== await fingerprint(c)) throw new Error('Repository changed while reading. Refresh.');
    return { oldText, newText, name: f.path };
  }
  return { discover, snapshot, content, context, getSnapshot, fingerprint, git, text, locks };
}
module.exports = { createGitService, parseNames, parseStats };
