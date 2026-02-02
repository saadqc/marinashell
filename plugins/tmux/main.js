function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function execOrThrow(sessionManager, tabId, command, options = {}) {
  const result = await sessionManager.exec(tabId, command, options);
  if (result.exitCode && Number(result.exitCode) !== 0) {
    const msg = (result.stderr || result.stdout || '').trim() || `Command failed: ${command}`;
    throw new Error(msg);
  }
  return result;
}

async function execAllowNonZero(sessionManager, tabId, command, options = {}) {
  // Like execOrThrow, but returns { stdout, stderr, exitCode } even when exitCode != 0.
  return sessionManager.exec(tabId, command, options);
}

function parseTmuxSessions(stdout) {
  if (!stdout) return [];
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // tmux format should be tab-separated, but some versions/configs end up emitting a literal "\t"
      // if the format string is passed with an escaped backslash. Support both.
      const parts = line.includes('\\t') ? line.split('\\t') : line.split('\t');
      const name = parts[0] || '';
      const windows = Number(parts[1] || 0);
      const attached = parts[2] === '1';
      const created = parts[3] || '';
      const activity = parts[4] || '';
      return { name, windows, attached, created, activity };
    })
    .filter((s) => s.name);
}

function parseScreenSessions(stdout) {
  // Typical `screen -ls` output:
  // There are screens on:
  //     1234.sessionname  (Detached)
  //     5678.pts-0.host   (Attached)
  // 2 Sockets in /run/screen/S-user.
  if (!stdout) return [];
  const lines = stdout.split('\n');
  const sessions = [];
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(/^(\d+\.[^\s]+)\s+\((Detached|Attached)\)/i);
    if (!match) continue;
    const id = match[1];
    const status = match[2].toLowerCase();
    const dot = id.indexOf('.');
    const name = dot >= 0 ? id.slice(dot + 1) : id;
    sessions.push({ id, name, status });
  }
  return sessions;
}

function isTmuxNoServerOutput(text) {
  const t = String(text || '').toLowerCase();
  // tmux emits variants like:
  // - "no server running on /tmp/tmux-1000/default"
  // - "error connecting to /tmp/tmux-1000/default (No such file or directory)"
  return t.includes('no server running') || (t.includes('error connecting to') && t.includes('/tmp/tmux-'));
}

function isScreenNoSocketsOutput(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('no sockets found') || t.includes('no sockets found in');
}

async function detectBinaries(sessionManager, tabId) {
  // Use POSIX sh syntax; avoid login shells.
  const cmd = `sh -c 'command -v tmux >/dev/null 2>&1 && echo TMUX=1 || echo TMUX=0; command -v screen >/dev/null 2>&1 && echo SCREEN=1 || echo SCREEN=0'`;
  const res = await execOrThrow(sessionManager, tabId, cmd, { timeoutMs: 8000 });
  const text = `${res.stdout || ''}${res.stderr || ''}`;
  return {
    tmux: /TMUX=1/.test(text),
    screen: /SCREEN=1/.test(text)
  };
}

module.exports = function (context) {
  const { sessionManager, registerIpc } = context;

  function ensureConnected(tabId) {
    const session = sessionManager.getSession(tabId);
    if (!session || !session.hostConfig || (session.sessionType !== 'ssh' && session.sessionType !== 'local')) {
      throw new Error('Not connected');
    }
  }

  registerIpc('status', async (_event, payload) => {
    try {
      ensureConnected(payload.tabId);
      const detected = await detectBinaries(sessionManager, payload.tabId);
      return { ok: true, ...detected };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to detect tmux/screen' };
    }
  });

  registerIpc('listTmux', async (_event, payload) => {
    try {
      ensureConnected(payload.tabId);
      const res = await execAllowNonZero(
        sessionManager,
        payload.tabId,
        `tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created_string}\t#{session_activity_string}'`,
        { timeoutMs: 8000 }
      );
      if (res.exitCode && Number(res.exitCode) !== 0) {
        const combined = `${res.stderr || ''}\n${res.stdout || ''}`.trim();
        if (isTmuxNoServerOutput(combined)) {
          return { ok: true, data: [] };
        }
        throw new Error(combined || 'Failed to list tmux sessions');
      }
      return { ok: true, data: parseTmuxSessions(res.stdout) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to list tmux sessions' };
    }
  });

  registerIpc('listScreen', async (_event, payload) => {
    try {
      ensureConnected(payload.tabId);
      const res = await execAllowNonZero(sessionManager, payload.tabId, `screen -ls`, { timeoutMs: 8000 });
      const combined = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
      if (res.exitCode && Number(res.exitCode) !== 0) {
        if (isScreenNoSocketsOutput(combined)) {
          return { ok: true, data: [] };
        }
        throw new Error(combined || 'Failed to list screen sessions');
      }
      return { ok: true, data: parseScreenSessions(res.stdout) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to list screen sessions' };
    }
  });

  registerIpc('createTmux', async (_event, payload) => {
    const { tabId, name } = payload || {};
    try {
      ensureConnected(tabId);
      const sessionName = name && String(name).trim() ? String(name).trim() : `marinashell-${Date.now()}`;
      await execOrThrow(sessionManager, tabId, `tmux new-session -d -s ${shellSingleQuote(sessionName)}`, { timeoutMs: 8000 });
      return { ok: true, name: sessionName };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to create tmux session' };
    }
  });

  registerIpc('killTmux', async (_event, payload) => {
    const { tabId, name } = payload || {};
    try {
      ensureConnected(tabId);
      if (!name) throw new Error('Missing session name');
      await execOrThrow(sessionManager, tabId, `tmux kill-session -t ${shellSingleQuote(name)}`, { timeoutMs: 8000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to kill tmux session' };
    }
  });

  registerIpc('renameTmux', async (_event, payload) => {
    const { tabId, oldName, newName } = payload || {};
    try {
      ensureConnected(tabId);
      const from = String(oldName || '').trim();
      const to = String(newName || '').trim();
      if (!from) throw new Error('Missing session name');
      if (!to) throw new Error('Missing new name');
      await execOrThrow(
        sessionManager,
        tabId,
        `tmux rename-session -t ${shellSingleQuote(from)} ${shellSingleQuote(to)}`,
        { timeoutMs: 8000 }
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to rename tmux session' };
    }
  });

  registerIpc('attachTmux', async (_event, payload) => {
    const { tabId, name } = payload || {};
    try {
      ensureConnected(tabId);
      if (!name) throw new Error('Missing session name');
      return { ok: true, command: `tmux attach -t ${shellSingleQuote(name)}` };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to build tmux attach command' };
    }
  });

  registerIpc('createScreen', async (_event, payload) => {
    const { tabId, name } = payload || {};
    try {
      ensureConnected(tabId);
      const sessionName = name && String(name).trim() ? String(name).trim() : `marinashell-${Date.now()}`;
      await execOrThrow(sessionManager, tabId, `screen -dmS ${shellSingleQuote(sessionName)}`, { timeoutMs: 8000 });
      return { ok: true, name: sessionName };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to create screen session' };
    }
  });

  registerIpc('killScreen', async (_event, payload) => {
    const { tabId, id } = payload || {};
    try {
      ensureConnected(tabId);
      if (!id) throw new Error('Missing screen id');
      await execOrThrow(sessionManager, tabId, `screen -S ${shellSingleQuote(id)} -X quit`, { timeoutMs: 8000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to kill screen session' };
    }
  });

  registerIpc('attachScreen', async (_event, payload) => {
    const { tabId, id, mode } = payload || {};
    try {
      ensureConnected(tabId);
      if (!id) throw new Error('Missing screen id');
      const attachMode = mode === 'multi' ? '-x' : '-r';
      return { ok: true, command: `screen ${attachMode} ${shellSingleQuote(id)}` };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to build screen attach command' };
    }
  });
};
