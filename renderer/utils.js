export function escapeShellPath(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function normalizePosixPath(raw) {
  const parts = String(raw || '').split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join('/')}` || '/';
}

function isWindowsDrivePath(value) {
  return /^[a-zA-Z]:([\\/]|$)/.test(value || '');
}

function normalizeWindowsRemotePath(value, basePath) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return basePath || '/';
  }
  const forward = trimmed.replace(/\\/g, '/');
  const driveMatch = forward.match(/^([a-zA-Z]):(?:\/(.*))?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const rest = driveMatch[2] || '';
    return rest ? normalizePosixPath(`/${drive}:/${rest}`) : `/${drive}:`;
  }
  if (/^\/[a-zA-Z]:/.test(forward)) {
    return normalizePosixPath(forward);
  }
  if (forward.startsWith('/')) {
    return normalizePosixPath(forward);
  }
  const base = basePath || '/';
  return normalizePosixPath(`${base.replace(/\/$/, '')}/${forward}`);
}

export function normalizeRemotePath(value, basePath, options = {}) {
  if (!value) {
    return '/';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '/';
  }
  const pathStyle = options.pathStyle || 'posix';
  if (pathStyle === 'windows' || isWindowsDrivePath(trimmed)) {
    return normalizeWindowsRemotePath(trimmed, basePath);
  }
  const isAbsolute = trimmed.startsWith('/');
  const base = isAbsolute ? '/' : (basePath || '/');
  const raw = isAbsolute ? trimmed : `${base.replace(/\/$/, '')}/${trimmed}`;
  return normalizePosixPath(raw);
}

export function formatRemotePath(value, pathStyle) {
  if (pathStyle !== 'windows') {
    return String(value || '').trim() || '/';
  }
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const forward = trimmed.replace(/\\/g, '/');
  if (forward === '/') {
    return '/';
  }
  const match = forward.match(/^\/?([a-zA-Z]):(?:\/(.*))?$/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2] ? match[2].replace(/\//g, '\\') : '';
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  return forward.replace(/\//g, '\\');
}

export function buildRemoteCdCommand(targetPath, options = {}) {
  const rawPath = String(targetPath || '').trim();
  const pathStyle = options.pathStyle || 'posix';
  const isWindowsLike = /^\/?[a-zA-Z]:/.test(rawPath);
  const effectiveStyle = pathStyle === 'windows' || isWindowsLike ? 'windows' : 'posix';
  const displayPath = effectiveStyle === 'windows' ? formatRemotePath(rawPath, effectiveStyle) : rawPath;
  return `cd ${escapeShellPath(displayPath)}`;
}

export function getPathLabel(value, pathStyle) {
  if (pathStyle === 'windows') {
    const display = formatRemotePath(value, pathStyle);
    const trimmed = display.replace(/\\$/, '');
    if (!trimmed) {
      return display || '';
    }
    if (/^[A-Za-z]:$/.test(trimmed)) {
      return trimmed;
    }
    const parts = trimmed.split('\\').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : trimmed;
  }
  const trimmed = String(value || '').replace(/\/$/, '');
  if (!trimmed) {
    return '/';
  }
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '/';
}

export function interpolateTabTitle(template, context = {}) {
  const source = String(template || '');
  return source.replace(/<([A-Za-z_][A-Za-z0-9_]*)(?:\[(-?\d*):(-?\d*)\])?>/g, (match, key, startRaw, endRaw) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      return match;
    }
    const chars = Array.from(String(context[key] == null ? '' : context[key]));
    if (startRaw === undefined && endRaw === undefined) {
      return chars.join('');
    }
    const start = startRaw === '' ? undefined : Number(startRaw);
    const end = endRaw === '' ? undefined : Number(endRaw);
    return chars.slice(start, end).join('');
  });
}

function trimTerminalLink(value) {
  let text = String(value || '').replace(/[.,;:!?"'`]+$/g, '');
  const pairs = [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' }
  ];
  for (const pair of pairs) {
    const openCount = text.split(pair.open).length - 1;
    let closeCount = text.split(pair.close).length - 1;
    while (text.endsWith(pair.close) && closeCount > openCount) {
      text = text.slice(0, -1);
      closeCount -= 1;
    }
  }
  return text;
}

export function findTerminalLinks(value) {
  const source = String(value || '');
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const links = [];
  let match = pattern.exec(source);
  while (match) {
    const text = trimTerminalLink(match[0]);
    if (text) {
      const isEmail = !/^(?:https?:\/\/|www\.)/i.test(text);
      links.push({
        text,
        start: match.index,
        end: match.index + text.length,
        type: isEmail ? 'email' : 'url',
        uri: isEmail ? `mailto:${text}` : (/^www\./i.test(text) ? `https://${text}` : text)
      });
    }
    match = pattern.exec(source);
  }
  return links;
}

export function fillTemplate(template, context) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return context[key];
    }
    return match;
  });
}

export function globToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i');
}

export function matchAssociation(fileName, associations) {
  if (!fileName || !Array.isArray(associations)) {
    return null;
  }
  for (const assoc of associations) {
    if (!assoc || !assoc.pattern) {
      continue;
    }
    const pattern = String(assoc.pattern);
    let matched = false;
    if (pattern.includes('*') || pattern.includes('?')) {
      matched = globToRegex(pattern).test(fileName);
    } else if (pattern.startsWith('.')) {
      matched = fileName.toLowerCase().endsWith(pattern.toLowerCase());
    } else {
      matched = fileName.toLowerCase() === pattern.toLowerCase();
    }
    if (matched) {
      return assoc;
    }
  }
  return null;
}

export function normalizeFileInput(fileInput) {
  if (!fileInput) {
    return { name: '', path: '' };
  }
  if (typeof fileInput === 'string') {
    const name = getPathLabel(fileInput);
    return { name, path: fileInput };
  }
  return {
    name: fileInput.name || getPathLabel(fileInput.path),
    path: fileInput.path,
    size: fileInput.size
  };
}

export function buildSftpUri(template, context) {
  const host = context.host || context.alias || '';
  if (!host) {
    return '';
  }
  const user = context.user || '';
  const port = context.port || '22';
  const pathValue = context.path || '/';
  const userPart = user ? `${user}@` : '';
  const base = `sftp://${userPart}${host}:${port}${pathValue}`;
  const filled = fillTemplate(template || base, { ...context, sftpUri: base });
  return filled || base;
}

export function parseShortcut(value, isMac) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const parts = value.toLowerCase().split(/\s*\+\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) {
    return null;
  }
  const shortcut = {
    key: '',
    ctrl: false,
    meta: false,
    alt: false,
    shift: false
  };
  for (const part of parts) {
    if (part === 'cmd' || part === 'command' || part === 'meta') {
      shortcut.meta = true;
      continue;
    }
    if (part === 'ctrl' || part === 'control') {
      shortcut.ctrl = true;
      continue;
    }
    if (part === 'alt' || part === 'option' || part === 'opt') {
      shortcut.alt = true;
      continue;
    }
    if (part === 'shift') {
      shortcut.shift = true;
      continue;
    }
    if (part === 'mod' || part === 'cmdorctrl' || part === 'commandorcontrol') {
      if (isMac) {
        shortcut.meta = true;
      } else {
        shortcut.ctrl = true;
      }
      continue;
    }
    shortcut.key = part;
  }
  if (!shortcut.key) {
    return null;
  }
  return shortcut;
}

export function matchesShortcutEvent(event, shortcut) {
  if (!shortcut || !event) {
    return false;
  }
  const key = event.key ? event.key.toLowerCase() : '';
  if (!key || key !== shortcut.key) {
    return false;
  }
  if (Boolean(event.metaKey) !== Boolean(shortcut.meta)) return false;
  if (Boolean(event.ctrlKey) !== Boolean(shortcut.ctrl)) return false;
  if (Boolean(event.altKey) !== Boolean(shortcut.alt)) return false;
  if (Boolean(event.shiftKey) !== Boolean(shortcut.shift)) return false;
  return true;
}
