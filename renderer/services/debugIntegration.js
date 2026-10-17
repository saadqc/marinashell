// Plain data contribution shared by separately bundled plugins; CodeMirror
// instances and extension classes remain owned by the Editor bundle.
const integration = window.__marinashellDebugIntegration ||= { provider: null, listeners: new Set(), actions: new Map(), actionListeners: new Set() };
integration.providers ||= new Map();
export function debugProvider(doc, id) {
  if (id) return integration.providers.get(id) || null;
  if (doc) return [...integration.providers.values()].find(provider => provider.supports?.(doc)) || null;
  return integration.provider || [...integration.providers.values()][0] || null;
}
export function setDebugProvider(provider, id = 'pydebug') {
  if (provider) integration.providers.set(id, provider); else integration.providers.delete(id);
  if (!integration.provider || ![...integration.providers.values()].includes(integration.provider)) integration.provider = provider || null;
  notifyDebugViews();
}
export function selectDebugProvider(id) { integration.provider = integration.providers.get(id) || null; notifyDebugViews(); }
export function notifyDebugViews() { for (const listener of integration.listeners) listener(); }
export function subscribeDebugViews(listener) { integration.listeners.add(listener); return () => integration.listeners.delete(listener); }
export function registerRunAction(id, action) { integration.actions.set(id, action); for (const listener of integration.actionListeners) listener(); return () => { integration.actions.delete(id); for (const listener of integration.actionListeners) listener(); }; }
export function runActions() { return [...integration.actions.entries()]; }
export function subscribeRunActions(listener) { integration.actionListeners.add(listener); return () => integration.actionListeners.delete(listener); }
