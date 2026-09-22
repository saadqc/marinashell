const LAYOUTS = new Set(['1x1', '2x1', '1x2', '2x2']);
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
    if (!/^(\/|[A-Za-z]:[\\/])/.test(currentPath) || /[\r\n\0]/.test(currentPath)) throw new Error(`Use an absolute directory path for ${manualTitle}.`);
    return { ...entry, host, currentPath, treeRootPath: currentPath, manualTitle, connected: !entry.readOnly };
  });
  return { ...input, kind: 'project', name, tabs, layout: LAYOUTS.has(input.layout) ? input.layout : '1x1', activeIndex: Math.max(0, Math.min(tabs.length - 1, Number(input.activeIndex) || 0)) };
}
module.exports = { normalizeProject };
