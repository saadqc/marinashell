import { normalizeRemotePath } from '../utils.js';
export function fileAction(tab, path, action, line = null) {
  const resolved = normalizeRemotePath(path, tab.currentPath || '/', { pathStyle: tab.remotePathStyle });
  window.dispatchEvent(new CustomEvent(action === 'editor' ? 'marinashell:editor:open' : 'marinashell:file:tail', {
    detail: { path: resolved, line, host: tab.host || '__local__', tabId: tab.id, groupId: tab.groupId || '' }
  }));
}
export function terminalFileAt(tab) {
  const selection = tab.term.getSelection().trim();
  let token = selection;
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || /[\x00-\x1f\x7f]/.test(token) || /^(https?:|www\.)/i.test(token) || /^[|;&<>]+$/.test(token)) return null;
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(token);
  const path = match ? match[1] : token;
  if (!path) return null;
  return { type: 'file', selection, path: normalizeRemotePath(path, tab.currentPath || '/', { pathStyle: tab.remotePathStyle }), line: match ? Number(match[2]) : null };
}

export const quoteFilePath = value => "\'" + String(value).replace(/\'/g, "\'\"\'\"\'") + "\'";
