function installGitOperations(service) {
  service.operation = async (snapshotId, action, payload = {}) => {
    const snapshot = service.getSnapshot(snapshotId); const c = service.context(snapshot.contextId);
    const key = `${c.host}\0${c.cwd}`;
    if (service.locks.has(key)) throw new Error('A Git operation is already running in this worktree');
    service.locks.add(key);
    try {
      if (snapshot.fingerprint !== await service.fingerprint(c)) throw new Error('Repository changed. Refresh before applying an operation.');
      const actual = (await service.text(c, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
      if (actual !== c.cwd) throw new Error('Repository context changed');
      if (snapshot.base && ['stage', 'unstage', 'commit'].includes(action)) throw new Error('Select Working changes before modifying the index');
      let args;
      if (['stage', 'unstage'].includes(action)) {
        const scopes = action === 'stage' ? ['unstaged', 'untracked'] : ['staged'];
        const files = snapshot.files.filter(row => scopes.includes(row.scope) && (payload.all || payload.fileIds?.includes(row.id)));
        const paths = [...new Set(files.flatMap(f => f.oldPath !== f.path ? [f.oldPath, f.path] : [f.path]))]; if (!paths.length) throw new Error('Select applicable changed files');
        args = action === 'stage' ? ['add', '-A', '--', ...paths] : snapshot.head ? ['restore', '--staged', '--', ...paths] : ['rm', '--cached', '-f', '--', ...paths];
      } else if (action === 'commit') {
        if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 30000) throw new Error('Enter a commit message');
        args = ['commit', '-m', payload.message];
      } else if (['fetch', 'pull', 'push'].includes(action)) {
        const remotes = (await service.text(c, ['remote'])).split('\n').filter(Boolean);
        if (!remotes.includes(payload.remote)) throw new Error('Select an existing remote');
        if (action === 'fetch') args = ['fetch', '--', payload.remote];
        else {
          if (typeof payload.branch !== 'string' || !payload.branch || payload.branch.length > 255) throw new Error('Select a branch');
          await service.text(c, ['check-ref-format', '--branch', payload.branch]);
          if (action === 'push') args = ['push', '--set-upstream', '--', payload.remote, `HEAD:refs/heads/${payload.branch}`];
          else args = ['pull', '--ff-only', '--', payload.remote, payload.branch];
        }
      } else if (['createBranch', 'switchBranch'].includes(action)) {
        if (typeof payload.branch !== 'string' || payload.branch.length > 255) throw new Error('Enter a branch name');
        await service.text(c, ['check-ref-format', '--branch', payload.branch]);
        args = action === 'createBranch' ? ['switch', '-c', payload.branch, '--'] : ['switch', '--', payload.branch];
      } else throw new Error('Unknown Git operation');
      const result = await service.git(c, args);
      return { output: (result.stdout + result.stderr).trim() };
    } finally { service.locks.delete(key); }
  };
}
module.exports = { installGitOperations };
