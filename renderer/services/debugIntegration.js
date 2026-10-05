// Plain data contribution shared by separately bundled plugins; CodeMirror
// instances and extension classes remain owned by the Editor bundle.
const integration = window.__marinashellDebugIntegration ||= { provider: null, listeners: new Set(), actions: new Map(), actionListeners: new Set() };
export function debugProvider() { return integration.provider; }
export function setDebugProvider(provider) { integration.provider = provider; notifyDebugViews(); }
export function notifyDebugViews() { for (const listener of integration.listeners) listener(); }
export function subscribeDebugViews(listener) { integration.listeners.add(listener); return () => integration.listeners.delete(listener); }
export function registerRunAction(id, action) { integration.actions.set(id, action); for (const listener of integration.actionListeners) listener(); return () => { integration.actions.delete(id); for (const listener of integration.actionListeners) listener(); }; }
export function runActions() { return [...integration.actions.entries()]; }
export function subscribeRunActions(listener) { integration.actionListeners.add(listener); return () => integration.actionListeners.delete(listener); }
