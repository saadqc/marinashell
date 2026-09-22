import { normalizeRemotePath } from '../utils.js';
export function fileAction(tab, path, action, line = null) {
  const resolved = normalizeRemotePath(path, tab.currentPath || '/', { pathStyle: tab.remotePathStyle });
  window.dispatchEvent(new CustomEvent(action === 'editor' ? 'marinashell:editor:open' : 'marinashell:file:tail', {
    detail: { path: resolved, line, host: tab.host || '__local__', tabId: tab.id, groupId: tab.groupId || '' }
  }));
}
export function terminalFileAt(tab, x, y) {
  if (tab.hoveredLink?.type === 'file') return tab.hoveredLink;
  const selection = tab.term.getSelection().trim();
  let token = selection && !/[\r\n]/.test(selection) ? selection : '';
  if (!token) {
    const rect = tab.term.element.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!rect || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    const column = Math.floor((x - rect.left) / (rect.width / tab.term.cols));
    const row = tab.term.buffer.active.viewportY + Math.floor((y - rect.top) / (rect.height / tab.term.rows));
    const text = tab.term.buffer.active.getLine(row)?.translateToString(true) || '';
    const left = text.slice(0, column + 1).search(/[^\s]*$/);
    const right = text.slice(column).search(/\s/);
    token = text.slice(left, right < 0 ? text.length : column + right);
  }
  token = token.replace(/^["']|["',;]$/g, '');
  if (!token || /[\r\n\0]/.test(token) || /^(https?:|www\.)/.test(token) || /^[|;&<>]+$/.test(token)) return null;
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(token);
  return { type: 'file', path: match ? match[1] : token, line: match ? Number(match[2]) : null };
}

export const quoteFilePath = value => "\'" + String(value).replace(/\'/g, "\'\"\'\"\'") + "\'";
