const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function normalizeStat(stat) {
  if (!stat) return null;
  const modified = Number(stat.mtimeMs || (stat.modifyTime ? stat.modifyTime * 1000 : 0));
  return {
    size: Number(stat.size || 0),
    mtimeMs: Number.isFinite(modified) ? Math.round(modified) : 0,
    mode: Number(stat.mode || 0)
  };
}

function changedSince(expected, current) {
  if (!expected || !current) return false;
  return Number(expected.size) !== Number(current.size)
    || Math.round(Number(expected.mtimeMs || 0)) !== Math.round(Number(current.mtimeMs || 0));
}

function decodeText(buffer) {
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be opened in the inline editor');
  }
  try {
    return UTF8_DECODER.decode(buffer);
  } catch (err) {
    throw new Error('This file is not valid UTF-8 text');
  }
}

function assertPayload(payload) {
  const tabId = payload && String(payload.tabId || '');
  const filePath = payload && String(payload.path || '');
  if (!tabId || !filePath) throw new Error('Missing session or file path');
  return { tabId, filePath };
}

function tempPathFor(filePath, pathApi) {
  const name = pathApi.basename(filePath);
  return pathApi.join(
    pathApi.dirname(filePath),
    `.${name}.marinashell-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
  );
}

module.exports = function activate({ sessionManager, registerIpc }) {
  function getSession(tabId) {
    const session = sessionManager.getSession(tabId);
    if (!session || !session.ptyProcess) throw new Error('Session is not connected');
    if (session.sessionType !== 'local' && !session.sftpClient) throw new Error('SFTP is not connected');
    return session;
  }

  async function statFile(session, filePath) {
    if (session.sessionType === 'local') {
      return normalizeStat(await fs.promises.stat(filePath));
    }
    return normalizeStat(await session.sftpClient.stat(filePath));
  }

  async function readFile(payload) {
    const { tabId, filePath } = assertPayload(payload);
    const session = getSession(tabId);
    const stat = await statFile(session, filePath);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`Inline editor limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
    }

    const data = session.sessionType === 'local'
      ? await fs.promises.readFile(filePath)
      : await session.sftpClient.get(filePath);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`Inline editor limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
    }
    return { ok: true, content: decodeText(buffer), stat };
  }

  async function saveLocal(session, filePath, buffer, originalStat) {
    const linkStat = await fs.promises.lstat(filePath);
    if (linkStat.isSymbolicLink() || process.platform === 'win32') {
      await fs.promises.writeFile(filePath, buffer);
      return;
    }

    const tempPath = tempPathFor(filePath, path);
    try {
      await fs.promises.writeFile(tempPath, buffer, { mode: originalStat.mode & 0o777 });
      await fs.promises.rename(tempPath, filePath);
    } catch (err) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  async function saveRemote(session, filePath, buffer, originalStat) {
    const sftp = session.sftpClient;
    const linkStat = await sftp.lstat(filePath).catch(() => null);
    const isSymlink = Boolean(linkStat && (Number(linkStat.mode || 0) & 0o170000) === 0o120000);
    if (isSymlink) {
      await sftp.put(buffer, filePath, {
        writeStreamOptions: { flags: 'w', encoding: null, mode: originalStat.mode & 0o777 }
      });
      if (session.listCache) session.listCache.delete(path.posix.dirname(filePath));
      return;
    }
    const tempPath = tempPathFor(filePath, path.posix);
    try {
      await sftp.put(buffer, tempPath, {
        writeStreamOptions: { flags: 'w', encoding: null, mode: originalStat.mode & 0o777 }
      });
      if (originalStat.mode) {
        await sftp.chmod(tempPath, originalStat.mode & 0o777).catch(() => {});
      }
      try {
        await sftp.posixRename(tempPath, filePath);
      } catch (renameError) {
        // Servers without the OpenSSH rename extension still get a complete temp upload
        // before the original is replaced. Direct put also preserves symlink targets.
        await sftp.put(buffer, filePath, {
          writeStreamOptions: { flags: 'w', encoding: null, mode: originalStat.mode & 0o777 }
        });
        await sftp.delete(tempPath).catch(() => {});
      }
    } catch (err) {
      await sftp.delete(tempPath).catch(() => {});
      throw err;
    }
    if (session.listCache) session.listCache.delete(path.posix.dirname(filePath));
  }

  async function saveFile(payload) {
    const { tabId, filePath } = assertPayload(payload);
    const session = getSession(tabId);
    const content = String(payload.content == null ? '' : payload.content);
    const buffer = Buffer.from(content, 'utf8');
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`Inline editor limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
    }

    const currentStat = await statFile(session, filePath);
    if (!payload.force && changedSince(payload.expectedStat, currentStat)) {
      return { ok: false, conflict: true, currentStat };
    }

    if (session.sessionType === 'local') {
      await saveLocal(session, filePath, buffer, currentStat);
    } else {
      await saveRemote(session, filePath, buffer, currentStat);
    }
    return { ok: true, stat: await statFile(session, filePath) };
  }

  function safe(handler) {
    return async (_event, payload) => {
      try {
        return await handler(payload || {});
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : 'Editor operation failed' };
      }
    };
  }

  registerIpc('read', safe(readFile));
  registerIpc('save', safe(saveFile));
};
