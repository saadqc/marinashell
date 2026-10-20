const api = window.api;
const container = document.getElementById('external-editor-list');
const defaultSelect = document.getElementById('external-editor-default');
const status = document.getElementById('external-editor-status');
const detect = document.getElementById('external-editor-detect');
let current = null;
let saving = false;
let loading = false;

async function invoke(action, payload) {
  const result = await api.invoke(`external-editors:${action}`, payload);
  if (!result?.ok) throw new Error(result?.error || 'Editor detection is unavailable.');
  return result;
}
function button(text, action) {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.addEventListener('click', () => Promise.resolve(action()).catch(error => { status.textContent = error.message; }));
  return element;
}
async function configure(id, location) {
  if (saving || !current) return;
  saving = true;
  container.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
  defaultSelect.disabled = true; detect.disabled = true;
  try {
    const overrides = Object.fromEntries(current.editors.filter(editor => editor.override).map(editor => [editor.id, editor.override]));
    if (id) { if (location) overrides[id] = location; else delete overrides[id]; }
    current = await invoke('configure', { defaultEditorId: defaultSelect.value, overrides });
    render(); status.textContent = 'Editor settings saved.';
  } catch (error) { render(); status.textContent = error.message; }
  finally {
    saving = false; defaultSelect.disabled = false; detect.disabled = false;
    container.querySelectorAll('button,input,select').forEach(element => { element.disabled = false; });
  }
}
function render() {
  detect.textContent = 'Detect again';
  container.replaceChildren();
  defaultSelect.replaceChildren(new Option('Choose each time', ''));
  for (const editor of current.editors) defaultSelect.add(new Option(editor.name, editor.id));
  defaultSelect.value = current.defaultEditorId;
  const editor = current.editors.find(item => item.id === current.defaultEditorId);
  detect.hidden = !editor;
  if (editor) {
    const row = document.createElement('div'); row.className = 'external-editor-setting'; row.dataset.editorId = editor.id;
    const name = document.createElement('label'); name.textContent = `${editor.name} application path`; name.htmlFor = `external-editor-path-${editor.id}`;
    const detail = document.createElement('span'); detail.className = 'hint';
    detail.textContent = editor.status === 'available' ? `${editor.override ? 'Custom path' : 'Auto-detected'}${editor.version ? ` · ${editor.version}` : ''}` : editor.status === 'invalid-path' ? 'Configured path unavailable. Choose an application or executable.' : 'Not installed or not detected';
    const input = document.createElement('input'); input.id = name.htmlFor; input.type = 'text'; input.value = editor.override || editor.path || '';
    input.placeholder = 'Application or executable path'; input.setAttribute('aria-label', `${editor.name} path`); input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('change', () => configure(editor.id, input.value.trim()));
    const actions = document.createElement('div'); actions.className = 'external-editor-setting-actions';
    actions.append(button('Browse…', async () => {
      const result = await invoke('browse', { editorId: editor.id });
      if (result.path) await configure(editor.id, result.path);
    }), detect, button('Use detected path', () => configure(editor.id, '')));
    row.append(name, detail, input, actions);
    if (editor.installations.length > 1) {
      const installations = document.createElement('select'); installations.setAttribute('aria-label', `${editor.name} installations`);
      installations.add(new Option('Choose another detected installation…', ''));
      for (const item of editor.installations) installations.add(new Option(`${item.path}${item.version ? ` · ${item.version}` : ''}`, item.path));
      installations.addEventListener('change', () => { if (installations.value) configure(editor.id, installations.value); }); row.append(installations);
    }
    container.append(row);
  } else {
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Choose an editor above to view its installation settings. Saved paths for other editors are kept.';
    container.append(hint);
  }
}
async function load(refresh = false) {
  if (loading || saving) return;
  loading = true;
  detect.disabled = true; defaultSelect.disabled = true;
  container.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
  status.textContent = current?.defaultEditorId ? 'Detecting the selected editor…' : 'Loading editor settings…';
  try { current = await invoke('list', { refresh }); render(); status.textContent = ''; }
  catch (error) {
    status.textContent = error.message;
    if (!current) { detect.hidden = false; detect.textContent = 'Try again'; container.replaceChildren(detect); }
  }
  finally {
    detect.disabled = false; defaultSelect.disabled = false; loading = false;
    container.querySelectorAll('button,input,select').forEach(element => { element.disabled = false; });
  }
}
defaultSelect.addEventListener('change', () => configure());
detect.addEventListener('click', () => load(true));
// Discovery stays lazy until the Editor settings panel is selected.
const observer = new MutationObserver(() => {
  if (!document.getElementById('preferences-editor').hidden && !current) load();
});
observer.observe(document.getElementById('preferences-editor'), { attributes: true, attributeFilter: ['hidden'] });
if (!document.getElementById('preferences-editor').hidden) load();
