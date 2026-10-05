const { randomUUID } = require('crypto');
const { createLibraryStore } = require('../../main/services/libraryStore');
function createDebugStore(root) {
  const breakpoints = createLibraryStore('pydebug-breakpoints', root);
  const watches = createLibraryStore('pydebug-watches', root);
  function saveBreakpoint(input) {
    const host = String(input.host || '__local__'); const projectId = String(input.projectId || '');
    const path = String(input.path || ''); const line = Number(input.line);
    if (!path.startsWith('/') || path.includes('\0') || !Number.isInteger(line) || line < 1) throw new Error('Choose an absolute source path and a positive line number');
    const condition = String(input.condition || '').trim();
    if (condition.length > 4096) throw new Error('Breakpoint condition is too long');
    const existing = breakpoints.read().find(b => b.host === host && b.projectId === projectId && b.path === path && b.line === line);
    return breakpoints.upsert({ id: input.id || existing?.id || randomUUID(), host, projectId, path, line, enabled: input.enabled !== false, condition });
  }
  function saveWatch(input) {
    const expression = String(input.expression || '').trim();
    if (!expression || expression.length > 4096) throw new Error('Enter a watch expression (up to 4096 characters)');
    return watches.upsert({ id: input.id || randomUUID(), projectId: String(input.projectId || ''), expression });
  }
  return { breakpoints, watches, saveBreakpoint, saveWatch };
}
module.exports = { createDebugStore };
