import { normalizeRemotePath } from '../utils.js';
export function fileAction(tab, path, action, line = null) {
  const resolved = normalizeRemotePath(path, tab.currentPath || '/', { pathStyle: tab.remotePathStyle });
  window.dispatchEvent(new CustomEvent(action === 'editor' ? 'marinashell:editor:open' : 'marinashell:file:tail', {
    detail: { path: resolved, line, host: tab.host || '__local__', tabId: tab.id, groupId: tab.groupId || '' }
  }));
}
function clickedTerminalToken(term, event) {
  const screen = event?.target?.closest?.('.xterm-screen');
  if (!screen || !term.element.contains(screen)) return null;
  const bounds = screen.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return '';
  const buffer = term.buffer.active;
  const column = Math.floor(x * term.cols / bounds.width);
  const row = buffer.viewportY + Math.floor(y * term.rows / bounds.height);
  const selected = term.getSelectionPosition();
  if (selected && (row > selected.start.y || row === selected.start.y && column >= selected.start.x)
    && (row < selected.end.y || row === selected.end.y && column < selected.end.x)) return term.getSelection();
  const line = buffer.getLine(row);
  if (!line) return '';
  const startColumn = line.getCell(column)?.getWidth() === 0 ? Math.max(0, column - 1) : column;
  const offset = line.translateToString(false, 0, startColumn).length;
  const text = line.translateToString(true);
  for (const match of text.matchAll(/"[^"]+"|'[^']+'|\S+/g)) {
    if (offset >= match.index && offset < match.index + match[0].length) return match[0];
  }
  return '';
}

export function terminalFileAt(tab, event) {
  const selection = (clickedTerminalToken(tab.term, event) ?? tab.term.getSelection()).trim();
  let token = selection;
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  if (!token || /[\x00-\x1f\x7f]/.test(token) || /^(https?:|www\.)/i.test(token) || /^[|;&<>]+$/.test(token)) return null;
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(token);
  const path = match ? match[1] : token;
  if (!path) return null;
  return { type: 'file', selection, path: normalizeRemotePath(path, tab.currentPath || '/', { pathStyle: tab.remotePathStyle }), line: match ? Number(match[2]) : null };
}

export const quoteFilePath = value => "\'" + String(value).replace(/\'/g, "\'\"\'\"\'") + "\'";
