const actions = window.__marinashellTerminalMenu ||= new Map();
export function registerTerminalMenuAction(id, action) { actions.set(id, action); return () => actions.delete(id); }
export function terminalMenuActions(tab) { return [...actions.values()].filter(action => action.visible?.(tab)); }
