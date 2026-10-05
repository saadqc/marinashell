const LAYOUTS = new Set(['1x1', '2x1', '1x2', '3-left', '2x2']);
const docking = require('../../renderer/services/dockingModel');
const { randomUUID } = require('crypto');
function normalizeProject(input) {
  const name = String(input?.name || '').trim();
  if (!name || name.length > 100) throw new Error('Enter a project name of up to 100 characters.');
  if (!Array.isArray(input.tabs) || !input.tabs.length || input.tabs.length > 32) throw new Error('A project needs between 1 and 32 directories.');
  const tabs = input.tabs.map((entry, index) => {
    const host = String(entry.host || '').trim();
    const currentPath = String(entry.currentPath || '').trim();
    const manualTitle = String(entry.manualTitle || '').trim();
    if (!host || /[\r\n\0]/.test(host)) throw new Error(`Choose a connection for directory ${index + 1}.`);
    if (!manualTitle) throw new Error(`Name directory ${index + 1}.`);
    if (entry.sessionKey !== undefined && (typeof entry.sessionKey !== 'string' || !entry.sessionKey || entry.sessionKey.length > 200)) throw new Error('Invalid terminal session key.');
    if (!/^(\/|[A-Za-z]:[\\/])/.test(currentPath) || /[\r\n\0]/.test(currentPath)) throw new Error(`Use an absolute directory path for ${manualTitle}.`);
    return { ...entry, sessionKey: entry.sessionKey || randomUUID(), host, currentPath, treeRootPath: currentPath, manualTitle, connected: !entry.readOnly };
  });
  let terminalLayout;
  if (input.terminalLayout !== undefined) {
    if (!Array.isArray(input.terminalLayout) || !input.terminalLayout.length || input.terminalLayout.length > 32) throw new Error('Invalid terminal layout.');
    terminalLayout = input.terminalLayout.map(rect => {
      const { x, y, width, height } = rect || {};
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) throw new Error('Invalid terminal pane bounds.');
      return { x, y, width, height };
    });
    if (terminalLayout.some((a, i) => terminalLayout.slice(i + 1).some(b => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height))) throw new Error('Terminal panes must not overlap.');
    terminalLayout.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  let dockLayout;
  if (input.dockLayout !== undefined) {
    dockLayout = docking.copy(docking.validate(input.dockLayout, 'terminal'));
    const sessionKeys = new Set(tabs.filter(tab => !tab.readOnly).map(tab => tab.sessionKey));
    if (docking.members(dockLayout).some(key => !sessionKeys.has(key))) throw new Error('A pane references a missing terminal.');
  }
  if (new Set(tabs.map(tab => tab.sessionKey)).size !== tabs.length) throw new Error('Duplicate terminal session keys.');
  return { ...input, dockLayout, terminalLayout, kind: 'project', name, tabs, layout: LAYOUTS.has(input.layout) ? input.layout : '1x1', activeIndex: Math.max(0, Math.min(tabs.length - 1, Number(input.activeIndex) || 0)) };
}
module.exports = { normalizeProject };
