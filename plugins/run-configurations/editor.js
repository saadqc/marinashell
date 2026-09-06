import { modal, button, confirmAction, showError } from '../../renderer/components/dialog.js';

const templates = [
  { label: 'Python script', type: 'python', mode: 'script', interpreter: 'python3' },
  { label: 'Python module', type: 'python', mode: 'module', interpreter: 'python3' },
  { label: 'Celery worker', type: 'python', mode: 'module', target: 'celery', args: '-A app worker --loglevel=INFO', interpreter: 'python3' },
  { label: 'Uvicorn server', type: 'python', mode: 'module', target: 'uvicorn', args: 'app:app --reload', interpreter: 'python3' },
  { label: 'Flask server', type: 'python', mode: 'module', target: 'flask', args: '--app app run', interpreter: 'python3' },
  { label: 'Node.js script', type: 'javascript', mode: 'script', interpreter: 'node' },
  { label: 'Node.js module', type: 'javascript', mode: 'module', interpreter: 'node' },
  { label: 'npm script', type: 'javascript', mode: 'npm', target: 'dev', interpreter: 'node' },
  { label: 'Shell script', type: 'shell', mode: 'script', interpreter: '/bin/bash' },
  { label: 'Shell commands', type: 'shell', mode: 'commands', interpreter: '/bin/bash' }
];
const clone = value => JSON.parse(JSON.stringify(value));
function select(options, value) {
  const el = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option'); item.value = typeof option === 'string' ? option : option.value;
    item.textContent = typeof option === 'string' ? option : option.label; el.append(item);
  }
  el.value = value; return el;
}
function input(value = '', placeholder = '') {
  const el = document.createElement('input'); el.value = value; el.placeholder = placeholder; return el;
}
function field(parent, label, control, hint) {
  const row = document.createElement('label'); row.className = 'run-field';
  const name = document.createElement('span'); name.textContent = label; row.append(name, control);
  if (hint) { const small = document.createElement('small'); small.textContent = hint; row.append(small); }
  parent.append(row); return row;
}
function check(parent, label, value, update) {
  const row = document.createElement('label'); row.className = 'run-check';
  const el = input(); el.type = 'checkbox'; el.checked = value; el.addEventListener('change', () => update(el.checked));
  row.append(el, document.createTextNode(label)); parent.append(row); return el;
}

export async function editConfigurations({ api, state, call, selectedId, onSaved, tmuxAvailable }) {
  let configurations = (await call('list')).configurations;
  const view = modal('Run Configurations', { wide: true });
  view.dialog.classList.add('run-editor');
  const layout = document.createElement('div'); layout.className = 'run-editor-layout';
  const sidebar = document.createElement('aside'); sidebar.className = 'run-editor-sidebar';
  const tools = document.createElement('div'); tools.className = 'run-editor-tools';
  const template = select(templates.map((t, index) => ({ value: String(index), label: t.label })), '0'); template.setAttribute('aria-label', 'Configuration template');
  const list = document.createElement('div'); list.className = 'run-config-list';
  const form = document.createElement('div'); form.className = 'run-config-form';
  const errorLine = document.createElement('div'); errorLine.className = 'run-error'; errorLine.setAttribute('role', 'alert');
  sidebar.append(tools, list); layout.append(sidebar, form); view.body.append(layout, errorLine);
  let draft = null; let clean = ''; let groupIds = []; let cleanGroups = '';
  let discoveryVersion = 0;
  const dirty = () => JSON.stringify(draft) !== clean || JSON.stringify(groupIds) !== cleanGroups;
  const newDraft = template => ({ id: crypto.randomUUID(), name: template.label, host: state.tabs.get(state.activeTabId)?.host || '__local__',
    cwd: state.tabs.get(state.activeTabId)?.currentPath || '~', target: '', args: '', manager: 'system', environment: '', managerPath: '',
    envFiles: [], env: {}, inheritEnv: true, multiInstance: false, tmux: false, tmuxSession: '', sourceFile: '', ...template });
  async function switchTo(config, isNew = false) {
    if (draft && dirty() && !await confirmAction('Discard unsaved changes?', 'Switch configurations without saving these changes?', 'Discard')) return;
    draft = clone(config); delete draft.label;
    groupIds = (state.appState.tabGroups || []).filter(g => (g.configurationIds || []).includes(draft.id)).map(g => g.id);
    clean = isNew ? '' : JSON.stringify(draft); cleanGroups = JSON.stringify(groupIds);
    renderList(); renderForm();
  }
  tools.append(template, button('Add', () => switchTo(newDraft(templates[Number(template.value)]), true)));
  function renderList() {
    list.replaceChildren();
    for (const type of ['python', 'javascript', 'shell']) {
      const items = configurations.filter(c => c.type === type);
      if (draft?.type === type && !items.some(c => c.id === draft.id)) items.push(draft);
      if (!items.length) continue;
      const heading = document.createElement('div'); heading.className = 'run-list-heading'; heading.textContent = { python: 'Python', javascript: 'JavaScript', shell: 'Shell' }[type]; list.append(heading);
      for (const config of items) list.append(button(config.id === draft?.id ? draft.name : config.name, () => switchTo(config), config.id === draft?.id ? 'selected' : ''));
    }
  }
  async function browse(current, kind = 'file') {
    const result = await call('browse', { host: draft.host, directory: current || draft.cwd || '~', kind });
    if (draft.host === '__local__') return result.path;
    return new Promise(resolve => {
      const picker = modal(kind === 'directory' ? 'Select remote directory' : 'Select remote file');
      const pathInput = input(result.directory); pathInput.setAttribute('aria-label', 'Remote directory');
      const rows = document.createElement('div'); rows.className = 'run-file-list';
      picker.body.append(pathInput, rows);
      let directory = result.directory;
      function draw(data) {
        directory = data.directory; pathInput.value = directory; rows.replaceChildren();
        rows.append(button('..', () => load(directory.replace(/\/[^/]+\/?$/, '') || '/')));
        for (const item of data.entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))) {
          if (!item.directory && kind === 'directory') continue;
          rows.append(button(`${item.directory ? '▸ ' : ''}${item.name}`, async () => {
            const target = `${directory.replace(/\/$/, '')}/${item.name}`;
            if (item.directory) await load(target); else { resolve(target); picker.close(); }
          }));
        }
      }
      async function load(target) { try { draw(await call('browse', { host: draft.host, directory: target, kind })); } catch (error) { showError(error); } }
      pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); load(pathInput.value); } });
      picker.footer.append(button('Cancel', () => { resolve(''); picker.close(); }, 'ghost-btn'));
      if (kind === 'directory') picker.footer.append(button('Select directory', () => { resolve(directory); picker.close(); }));
      picker.dialog.addEventListener('close', () => resolve(''), { once: true }); draw(result);
    });
  }
  function pathField(label, key, kind = 'file', hint = '') {
    const row = document.createElement('div'); row.className = 'run-path-field';
    const el = input(draft[key]); el.addEventListener('input', () => draft[key] = el.value);
    row.append(el, button('Browse…', async () => { try { const value = await browse(draft.cwd, kind); if (value) { draft[key] = value; el.value = value; } } catch (error) { showError(error); } }));
    field(form, label, row, hint); return el;
  }
  function textField(label, key, placeholder, hint) {
    const el = input(draft[key], placeholder); el.addEventListener('input', () => { draft[key] = el.value; if (key === 'name') renderList(); });
    field(form, label, el, hint); return el;
  }
  async function editEnv() {
    const envView = modal('Environment Variables', { wide: true }); envView.dialog.classList.add('run-env-dialog');
    let inherit = draft.inheritEnv !== false;
    const table = document.createElement('div'); table.className = 'run-env-table';
    const heading = document.createElement('div'); heading.className = 'run-env-row'; heading.innerHTML = '<strong>Name</strong><strong>Value</strong><span></span>'; table.append(heading);
    const rows = [];
    function add(key = '', value = '') {
      const row = document.createElement('div'); row.className = 'run-env-row';
      const name = input(key, 'VARIABLE'); const val = input(value, 'Value'); name.setAttribute('aria-label', 'Variable name'); val.setAttribute('aria-label', 'Variable value');
      const entry = { row, name, val }; rows.push(entry);
      row.append(name, val, button('−', () => { row.remove(); rows.splice(rows.indexOf(entry), 1); })); table.append(row);
    }
    Object.entries(draft.env || {}).forEach(([key, value]) => add(key, value));
    if (!rows.length) add();
    const feedback = document.createElement('div'); feedback.className = 'run-error'; feedback.setAttribute('role', 'alert');
    envView.body.append(table, button('Add variable', () => add()));
    check(envView.body, 'Include system environment variables', inherit, value => inherit = value);
    const hint = document.createElement('p'); hint.className = 'run-hint'; hint.textContent = 'Values here override .env files. Values are literal; shell expressions are not evaluated.'; envView.body.append(hint, feedback);
    envView.footer.append(button('Cancel', envView.close, 'ghost-btn'), button('OK', () => {
      const values = {};
      for (const row of rows) {
        const name = row.name.value.trim(); if (!name && !row.val.value) continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { feedback.textContent = `Invalid variable name: ${name}`; return; }
        if (Object.hasOwn(values, name)) { feedback.textContent = `Duplicate variable: ${name}`; return; }
        values[name] = row.val.value;
      }
      draft.env = values; draft.inheritEnv = inherit; envView.close(); renderForm();
    }));
  }
  function createEnvFile() {
    const envView = modal('Create environment file');
    const file = input(`${draft.cwd?.replace(/\/$/, '') || '~'}/.env`);
    field(envView.body, draft.host === '__local__' ? 'Local path' : 'Remote path', file);
    const content = document.createElement('textarea'); content.rows = 10; content.placeholder = 'VARIABLE=value'; field(envView.body, 'Contents', content);
    const feedback = document.createElement('div'); feedback.className = 'run-error'; envView.body.append(feedback);
    envView.footer.append(button('Cancel', envView.close, 'ghost-btn'), button('Create', async () => {
      try { await call('env-create', { host: draft.host, file: file.value, content: content.value, cwd: draft.cwd }); draft.envFiles ||= []; draft.envFiles.push(file.value); envView.close(); renderForm(); }
      catch (error) { feedback.textContent = error.message; }
    }));
  }
  function renderForm() {
    discoveryVersion++; form.replaceChildren(); errorLine.textContent = '';
    if (!draft) { form.textContent = 'Choose a template to create a run configuration.'; return; }
    textField('Name', 'name');
    const hosts = [{ value: '__local__', label: 'Local machine' }, ...[...state.hostConfigs.entries()].filter(([id]) => id !== '__local__').map(([id]) => ({ value: id, label: `SSH · ${id}` }))];
    if (!hosts.some(item => item.value === draft.host)) hosts.push({ value: draft.host, label: `SSH · ${draft.host} (unavailable)` });
    const host = select(hosts, draft.host); host.addEventListener('change', () => { draft.host = host.value; draft.tmux = false; draft.manager = 'system'; draft.environment = ''; draft.managerPath = ''; draft.interpreter = draft.type === 'python' ? 'python3' : draft.type === 'javascript' ? 'node' : '/bin/bash'; renderForm(); });
    field(form, 'Run on', host);
    const type = select([{ value: 'python', label: 'Python' }, { value: 'javascript', label: 'JavaScript' }, { value: 'shell', label: 'Shell' }], draft.type);
    type.addEventListener('change', () => { draft.type = type.value; draft.mode = 'script'; draft.manager = 'system'; draft.environment = ''; draft.managerPath = ''; draft.interpreter = draft.type === 'python' ? 'python3' : draft.type === 'javascript' ? 'node' : '/bin/bash'; renderList(); renderForm(); }); field(form, 'Type', type);
    const environmentRow = document.createElement('div'); environmentRow.className = 'run-path-field';
    const discovered = select([{ value: '', label: 'Detect environments or enter paths below' }], '');
    const discoveryHint = document.createElement('small'); discoveryHint.className = 'run-hint';
    const detect = button('Detect', async () => {
      detect.disabled = true; discoveryHint.textContent = 'Detecting on the selected host…'; const version = discoveryVersion;
      try {
        const result = await call('discover', { host: draft.host, type: draft.type });
        if (version !== discoveryVersion) return;
        discovered.replaceChildren(new Option('Select an interpreter / environment', ''));
        result.runtimes.forEach((runtime, i) => discovered.add(new Option(runtime.label, String(i))));
        discovered.onchange = () => { const runtime = result.runtimes[Number(discovered.value)]; if (runtime && discovered.value !== '') { Object.assign(draft, runtime); delete draft.label; renderForm(); } };
        discoveryHint.textContent = result.warnings.length ? result.warnings.join(' · ') : `${result.runtimes.length} environments found`;
        const sessionList = form.querySelector('datalist'); if (sessionList) { sessionList.replaceChildren(); for (const name of result.tmuxSessions) sessionList.append(new Option(name, name)); }
      } catch (error) { discoveryHint.textContent = error.message; }
      finally { detect.disabled = false; }
    });
    environmentRow.append(discovered, detect); field(form, 'Environment', environmentRow); form.append(discoveryHint);
    const managers = draft.type === 'python' ? ['system', 'conda', 'mamba', 'micromamba', 'pyenv'] : draft.type === 'javascript' ? ['system', 'nvm'] : ['system'];
    const manager = select(managers.map(value => ({ value, label: value === 'system' ? 'Direct interpreter' : value })), draft.manager || 'system');
    manager.addEventListener('change', () => { draft.manager = manager.value; renderForm(); }); field(form, 'Environment manager', manager);
    if (draft.manager && draft.manager !== 'system') {
      textField('Environment / version', 'environment', draft.manager === 'nvm' ? 'v22.0.0' : 'Name or absolute environment path');
      pathField(draft.manager === 'nvm' ? 'nvm initialization file' : 'Manager executable', 'managerPath');
    }
    pathField(draft.type === 'javascript' ? 'Node interpreter' : draft.type === 'shell' ? 'Shell interpreter' : 'Python interpreter', 'interpreter');
    const modes = draft.type === 'python' ? ['script', 'module'] : draft.type === 'javascript' ? ['script', 'module', 'npm'] : ['script', 'commands'];
    const mode = select(modes, draft.mode); mode.addEventListener('change', () => { draft.mode = mode.value; renderForm(); }); field(form, 'Run mode', mode);
    if (draft.mode === 'script') pathField('Script path', 'target');
    else if (draft.mode === 'commands') { const code = document.createElement('textarea'); code.rows = 5; code.value = draft.target; code.addEventListener('input', () => draft.target = code.value); field(form, 'Shell commands', code); }
    else textField(draft.mode === 'npm' ? 'npm script' : 'Module name', 'target', draft.mode === 'npm' ? 'dev' : draft.type === 'python' ? 'celery, uvicorn, flask…' : 'package-name');
    textField('Arguments', 'args', '', 'Use quotes for arguments containing spaces.');
    pathField('Working directory', 'cwd', 'directory');
    if (draft.type === 'shell') pathField('Source before running (optional)', 'sourceFile', 'file', 'For example ~/.bashrc or ~/.zshrc, read by the selected shell.');
    const envButton = button(`Edit variables… (${Object.keys(draft.env || {}).length})`, editEnv); field(form, 'Environment variables', envButton);
    const envFiles = document.createElement('textarea'); envFiles.rows = 2; envFiles.value = (draft.envFiles || []).join('\n'); envFiles.placeholder = 'One path per line';
    envFiles.addEventListener('input', () => draft.envFiles = envFiles.value.split('\n').map(s => s.trim()).filter(Boolean));
    field(form, draft.host === '__local__' ? '.env files' : 'Remote .env files', envFiles, 'Loaded in order; later files override earlier files.');
    const envTools = document.createElement('div'); envTools.className = 'run-inline-actions';
    envTools.append(button('Add file…', async () => { try { const file = await browse(draft.cwd); if (file) { draft.envFiles ||= []; draft.envFiles.push(file); renderForm(); } } catch (error) { showError(error); } }), button('Create .env file…', createEnvFile)); form.append(envTools);
    check(form, 'Allow multiple instances', Boolean(draft.multiInstance), value => draft.multiInstance = value);
    if (draft.host !== '__local__') {
      const tmux = check(form, 'Run in tmux', Boolean(draft.tmux), value => { draft.tmux = value; renderForm(); }); tmux.disabled = !tmuxAvailable;
      if (!tmuxAvailable) { const hint = document.createElement('small'); hint.className = 'run-hint'; hint.textContent = 'Enable the tmux plugin in Settings to use this option.'; form.append(hint); }
      if (draft.tmux) {
        const session = textField('tmux session', 'tmuxSession', `marina-${draft.id.slice(0, 12)}`, 'Reuses the session with a dedicated window for each run. Detect lists existing sessions.');
        const options = document.createElement('datalist'); options.id = `tmux-sessions-${draft.id}`; session.setAttribute('list', options.id); form.append(options);
      }
    }
    const groups = state.appState.tabGroups || [];
    if (groups.length) {
      const title = document.createElement('div'); title.className = 'run-list-heading'; title.textContent = 'Show in groups'; form.append(title);
      for (const group of groups) check(form, group.name, groupIds.includes(group.id), checked => { groupIds = checked ? [...groupIds, group.id] : groupIds.filter(id => id !== group.id); });
    }
  }
  async function save(close = false) {
    try {
      if (!draft) return;
      const result = await call('save', { configuration: draft }); draft = result.configuration;
      configurations = (await call('list')).configurations;
      for (const group of state.appState.tabGroups || []) {
        const ids = new Set(group.configurationIds || []);
        if (groupIds.includes(group.id)) ids.add(draft.id); else ids.delete(draft.id);
        group.configurationIds = [...ids];
      }
      await api.updateState({ tabGroups: state.appState.tabGroups });
      clean = JSON.stringify(draft); cleanGroups = JSON.stringify(groupIds);
      await onSaved(draft.id); if (close) view.close(); else { renderList(); renderForm(); }
    } catch (error) { errorLine.textContent = error.message; }
  }
  const duplicate = button('Duplicate', () => { if (draft) switchTo({ ...clone(draft), id: crypto.randomUUID(), name: `${draft.name} copy` }, true); });
  const remove = button('Delete', async () => {
    if (!draft || !await confirmAction('Delete configuration?', `Delete “${draft.name}”?`, 'Delete')) return;
    try { await call('delete', { id: draft.id }); configurations = (await call('list')).configurations; draft = null; clean = ''; await onSaved(); renderList(); renderForm(); }
    catch (error) { errorLine.textContent = error.message; }
  }, 'danger');
  view.footer.append(duplicate, remove);
  const spacer = document.createElement('span'); spacer.style.flex = '1'; view.footer.append(spacer);
  async function cancel() { if (!dirty() || await confirmAction('Discard unsaved changes?', 'Close without saving configuration changes?', 'Discard')) view.close(); }
  view.footer.append(button('Cancel', cancel, 'ghost-btn'), button('Apply', () => save()), button('Save', () => save(true)));
  // Override the generic dialog's Escape handler to preserve drafts.
  view.dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }, { capture: true });
  const initial = configurations.find(c => c.id === selectedId) || configurations[0];
  if (initial) await switchTo(initial); else await switchTo(newDraft(templates[0]), true);
}
