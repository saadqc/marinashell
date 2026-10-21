function button(label, action) {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
  element.addEventListener('click', () => Promise.resolve(action()).catch(error => { element.title = error.message; })); return element;
}
function message(value) {
  if (value.error) return value.error;
  return { idle: `MarinaShell ${value.currentVersion}`, current: `MarinaShell ${value.currentVersion} is up to date.`, checking: 'Checking for updates…', available: `MarinaShell ${value.version} is available.`, downloading: `Downloading MarinaShell ${value.version}… ${value.progress}%`, ready: value.installerKind === 'appimage' ? `MarinaShell ${value.version} is downloaded. Replace your AppImage with this verified download.` : `MarinaShell ${value.version} is ready.`, installing: 'Installing update and restarting…', development: 'Updates are available in the installed application.', unsupported: 'No update package is available for this platform.' }[value.status] || '';
}
function style() {
  if (document.getElementById('updates-style')) return;
  const element = document.createElement('style'); element.id = 'updates-style'; element.textContent = `
.updates-banner{position:fixed;right:18px;bottom:32px;z-index:4000;max-width:460px;padding:14px;background:var(--surface-raised,#242830);color:var(--text,#eee);border:1px solid var(--border,#555);border-radius:9px;box-shadow:0 8px 32px #0005;font:13px system-ui}.updates-banner[hidden]{display:none}.updates-actions{display:flex;gap:8px;align-items:center;margin-top:10px}.updates-actions button{font:inherit;padding:7px 11px;border:1px solid var(--border,#555);border-radius:6px;background:var(--surface-sidebar,#282c34);color:inherit;cursor:pointer}.updates-actions button:disabled{opacity:.5;cursor:default}.updates-notes{white-space:pre-wrap;max-height:180px;overflow:auto;font:12px system-ui}.updates-option{display:flex;gap:8px;align-items:center;margin-top:12px}.updates-option input{width:auto!important;margin:0!important}.updates-progress{width:100%;margin-top:10px}.updates-message{white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.append(element);
}
export function installUpdateUI(api) {
  if (!api?.onUpdateState) return;
  style(); let dismissed = '', previousReady = '';
  const box = document.createElement('aside'); box.className = 'updates-banner'; box.hidden = true; box.setAttribute('aria-label', 'Application update'); box.setAttribute('aria-live', 'polite');
  const text = document.createElement('div'); text.className = 'updates-message';
  const actions = document.createElement('div'); actions.className = 'updates-actions';
  const primary = button('Update', () => api.invoke(primary.dataset.action));
  const later = button('Later', () => { dismissed = `${box.dataset.status}:${box.dataset.version}`; box.hidden = true; }); actions.append(primary, later); box.append(text, actions); document.body.append(box);
  function render(value) {
    box.dataset.status = value.status; box.dataset.version = value.version;
    const visible = ['available', 'downloading', 'ready', 'installing'].includes(value.status);
    box.hidden = !visible || dismissed === `${value.status}:${value.version}`;
    text.textContent = message(value);
    primary.textContent = value.status === 'ready' ? (value.canInstall ? 'Restart and Update' : value.installerKind === 'appimage' ? 'Show Download' : 'Open Installer') : value.status === 'downloading' ? `Downloading ${value.progress}%` : value.status === 'installing' ? 'Restarting…' : 'Update';
    primary.dataset.action = value.status === 'ready' ? 'updates:restart' : 'updates:download';
    primary.disabled = ['downloading', 'installing'].includes(value.status); later.disabled = value.status === 'installing';
    if (value.status === 'ready' && previousReady !== value.version) { dismissed = ''; previousReady = value.version; box.hidden = false; }
  }
  api.onUpdateState(render); api.invoke('updates:get').then(render).catch(() => {});
}
export function installUpdateSettings(api, root) {
  style(); const text = document.createElement('p'); text.className = 'updates-message'; text.setAttribute('role', 'status');
  const progress = document.createElement('progress'); progress.max = 100; progress.className = 'updates-progress';
  const actions = document.createElement('div'); actions.className = 'updates-actions';
  const check = button('Check for Updates', () => api.invoke('updates:check'));
  const update = button('Update', () => api.invoke(update.dataset.action)); actions.append(check, update);
  const notes = document.createElement('pre'); notes.className = 'updates-notes';
  const options = {};
  for (const [key, title] of [['automaticChecks', 'Automatically check for updates'], ['automaticDownload', 'Automatically download updates']]) {
    const label = document.createElement('label'); label.className = 'updates-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.addEventListener('change', () => api.invoke('updates:configure', { [key]: input.checked }).catch(error => { text.textContent = error.message; })); label.append(input, title); options[key] = input; root.append(label);
  }
  root.prepend(text, progress, actions, notes);
  function render(value) {
    text.textContent = message(value); notes.textContent = value.notes || ''; notes.hidden = !value.notes;
    progress.hidden = value.status !== 'downloading'; progress.value = value.progress;
    check.disabled = ['checking', 'downloading', 'installing', 'development'].includes(value.status);
    update.hidden = !value.version || ['current', 'development', 'unsupported'].includes(value.status);
    update.textContent = value.status === 'ready' ? (value.canInstall ? 'Restart and Update' : value.installerKind === 'appimage' ? 'Show Download' : 'Open Installer') : value.status === 'downloading' ? 'Downloading…' : 'Update';
    update.disabled = ['checking', 'downloading', 'installing'].includes(value.status);
    update.dataset.action = value.status === 'ready' ? 'updates:restart' : 'updates:download';
    for (const [key, input] of Object.entries(options)) input.checked = value.preferences[key];
  }
  api.onUpdateState(render); api.invoke('updates:get').then(render).catch(error => { text.textContent = error.message; });
}
export function installRestartGuard(api, state, persistence) {
  if (!api?.onUpdatePrepare) return;
  let locked = false;
  api.onUpdateUnlock(() => { if (locked) { document.body.inert = false; locked = false; } });
  api.onUpdatePrepare(async ({ id }) => {
    try {
      if (!state.workspaceReady || !state.updateReady) throw new Error('Wait for the workspace to finish loading.');
      const dirty = window.marinashellEditorDocuments?.list().some(document => document.dirty);
      if (dirty) throw new Error('Save or close unsaved editor files before restarting.');
      document.body.inert = true; locked = true;
      if (await persistence.persistTabs() !== true) throw new Error('The workspace could not be saved. Try again before restarting.');
      api.respondUpdatePrepare({ id, ok: true, connected: [...state.tabs.values()].some(tab => tab.connected) });
    } catch (error) { document.body.inert = false; locked = false; api.respondUpdatePrepare({ id, ok: false, error: error.message }); }
  });
}
