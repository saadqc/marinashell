const integration = window.__marinashellDiffIntegration ||= { mount: null };
export function registerDiffRenderer(mount) { integration.mount = mount; }
export function mountDiff(container, options) {
  if (!integration.mount) throw new Error('Enable the Editor plugin to view CodeMirror diffs');
  return integration.mount(container, options);
}
