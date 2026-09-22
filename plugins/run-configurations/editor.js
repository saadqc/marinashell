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
  const view = modal('Run configurations', { wide: true });
  view.dialog.classList.add('run-editor');
  const layout = document.createElement('div'); layout.className = 'run-editor-layout';
  const sidebar = document.createElement('aside'); sidebar.className = 'run-editor-sidebar';
  const tools = document.createElement('div'); tools.className = 'run-editor-tools';
  const template = select(templates.map((t, index) => ({ value: String(index), label: t.label })), '0'); template.setAttribute('aria-label', 'Configuration template');
  const list = document.createElement('div'); list.className = 'run-config-list';
  const form = document.createElement('div'); form.className = 'run-config-form';
  let sectionParent = form; let activeSection = 'run';
  const errorLine = document.createElement('div'); errorLine.className = 'run-error'; errorLine.setAttribute('role', 'alert');
  sidebar.append(tools, list); layout.append(sidebar, form); view.body.append(layout, errorLine);
  let draft = null; let clean = ''; let groupIds = []; let cleanGroups = '';
  let discoveryVersion = 0; let lastDiscovery = null;
  const groupDefaultsCache = new Map(); let prefillGroup = null; let suggestionBox = null;
  const dirty = () => JSON.stringify(draft) !== clean || JSON.stringify(groupIds) !== cleanGroups;
  const newDraft = template => ({ id: crypto.randomUUID(), name: template.label, host: state.tabs.get(state.activeTabId)?.host || '__local__',
    cwd: state.tabs.get(state.activeTabId)?.currentPath || '~', target: '', args: '', manager: 'system', environment: '', managerPath: '',
    envFiles: [], setupScripts: [], env: {}, inheritEnv: true, multiInstance: false, tmux: false, tmuxSession: '', sourceFile: '', ...template });
  const defaultKeys = ['cwd', 'interpreter', 'manager', 'managerPath', 'environment', 'envFiles', 'setupScripts', 'inheritEnv'];
  function mergeDefaults(target, defaults) {
    for (const key of defaultKeys) {
      const value = defaults ? defaults[key] : undefined;
      const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
      if (!empty) target[key] = clone(value);
    }
  }
  async function applyGroupPrefill() {
    const groupId = state.tabs.get(state.activeTabId)?.groupId;
    if (!groupId) return;
    try {
      const result = await call('group-defaults-get', { groupId });
      if (!result.defaults) return;
      groupDefaultsCache.set(groupId, result.defaults);
      mergeDefaults(draft, result.defaults);
      prefillGroup = { id: groupId, name: result.defaults.name || (state.appState.tabGroups || []).find(group => group.id === groupId)?.name || '' };
    } catch (_) { /* Defaults are optional; a failed read must not block creation. */ }
  }
  async function switchTo(config, isNew = false) {
    if (draft && dirty() && !await confirmAction('Discard unsaved changes?', 'Switch configurations without saving these changes?', 'Discard')) return;
    if (draft?.id !== config.id) activeSection = 'run';
    draft = clone(config); delete draft.label;
    prefillGroup = null;
    if (isNew && !draft.setupScripts) draft.setupScripts = [];
    if (isNew) await applyGroupPrefill();
    groupIds = (state.appState.tabGroups || []).filter(g => (g.configurationIds || []).includes(draft.id)).map(g => g.id);
    clean = isNew ? '' : JSON.stringify(draft); cleanGroups = JSON.stringify(groupIds);
    renderList(); renderForm();
  }
  tools.append(template, button('Add', () => switchTo(newDraft(templates[Number(template.value)]), true)));
  const collapsed = new Set();
  const kind = c => c.type === 'python' && c.mode === 'module' && c.target === 'flask' ? 'flask' : c.type;
  function icon(type) {
    const image = document.createElement('img'); image.className = 'run-type-icon'; image.alt = '';
    image.src = new URL(`../../assets/${type === 'javascript' ? 'icons/file-icons/language-javascript.svg' : `jetbrains/${type}.svg`}`, import.meta.url).href;
    return image;
  }
  function renderList() {
    list.replaceChildren(); list.setAttribute('role', 'tree');
    const all = configurations.map(c => c.id === draft?.id ? draft : c);
    if (draft && !all.some(c => c.id === draft.id)) all.push(draft);
    for (const type of ['flask', 'python', 'javascript', 'shell']) {
      const items = all.filter(c => kind(c) === type);
      if (!items.length) continue;
      const heading = button('', () => { collapsed.has(type) ? collapsed.delete(type) : collapsed.add(type); renderList(); }, 'run-list-heading');
      heading.setAttribute('role', 'treeitem'); heading.setAttribute('aria-expanded', String(!collapsed.has(type)));
      const arrow = document.createElement('span'); arrow.className = 'run-tree-arrow'; arrow.textContent = collapsed.has(type) ? '›' : '⌄';
      heading.append(arrow, icon(type), document.createTextNode({ flask: 'Flask server', python: 'Python', javascript: 'JavaScript', shell: 'Shell Script' }[type])); list.append(heading);
      if (collapsed.has(type)) continue;
      const group = document.createElement('div'); group.setAttribute('role', 'group');
      for (const config of items) {
        const row = button('', () => switchTo(config), config.id === draft?.id ? 'run-tree-item selected' : 'run-tree-item');
        row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', String(config.id === draft?.id));
        row.append(icon(type), document.createTextNode(config.name)); group.append(row);
      }
      list.append(group);
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
    const browseButton = row.lastElementChild; browseButton.classList.add('run-browse');
    browseButton.setAttribute('aria-label', `Browse ${label.toLowerCase()}`); browseButton.title = `Browse ${label.toLowerCase()}`;
    browseButton.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M1.5 4V2.5h5l2 2h6v9h-13z"/></svg>';
    field(sectionParent, label, row, hint); return el;
  }
  function textField(label, key, placeholder, hint) {
    const el = input(draft[key], placeholder); el.addEventListener('input', () => { draft[key] = el.value; if (key === 'name') renderList(); });
    field(sectionParent, label, el, hint); return el;
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
  function renderSuggestions(scan) {
    if (!suggestionBox) return;
    suggestionBox.replaceChildren();
    const joinPath = (base, part) => `${String(base || '~').replace(/\/+$/, '')}/${part}`;
    const chips = document.createElement('div'); chips.className = 'run-inline-actions';
    const add = (label, apply) => chips.append(button(label, () => { apply(); renderForm(); }, 'run-suggestion'));
    for (const dir of scan.entryDirs || []) {
      const target = joinPath(draft.cwd, dir);
      if (target !== draft.cwd) add(`Working directory: ${target}/`, () => draft.cwd = target);
    }
    for (const file of scan.files || []) {
      const full = joinPath(draft.cwd, file);
      if (/\.autoenv/.test(file) || file === '.envrc') add(`Run ${file} as setup script`, () => { draft.setupScripts ||= []; draft.setupScripts.push({ path: full, shell: /\.zsh$/i.test(file) ? 'zsh' : 'bash' }); });
      else if (file === '.env') add('Add .env to environment files', () => { draft.envFiles ||= []; if (!draft.envFiles.includes(full)) draft.envFiles.push(full); });
    }
    if ((scan.files || []).includes('.venv/bin/python')) add('Use .venv Python interpreter', () => { draft.interpreter = joinPath(draft.cwd, '.venv/bin/python'); draft.manager = 'system'; draft.environment = ''; draft.managerPath = ''; });
    if (chips.children.length) {
      const title = document.createElement('small'); title.className = 'run-hint'; title.textContent = 'Project suggestions — nothing is applied until you click:';
      suggestionBox.append(title, chips);
    }
  }
  function renderForm() {
    discoveryVersion++; form.replaceChildren(); errorLine.textContent = '';
    if (!draft) { form.textContent = 'Choose a template to create a run configuration.'; return; }
    const sections = new Map(); const tabs = document.createElement('div'); tabs.className = 'run-form-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Configuration sections');
    form.append(tabs);
    const showSection = key => {
      activeSection = key;
      for (const [id, { panel, control }] of sections) {
        panel.hidden = id !== key; control.setAttribute('aria-selected', String(id === key)); control.tabIndex = id === key ? 0 : -1;
      }
    };
    for (const [key, title] of [['run', 'Run'], ['environment', 'Environment'], ['launch', 'Before launch'], ['projects', 'Projects']]) {
      const panel = document.createElement('section'); panel.className = 'run-form-panel'; panel.id = `run-panel-${key}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `run-section-${key}`);
      const control = button(title, () => showSection(key)); control.id = `run-section-${key}`; control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', panel.id);
      control.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const keys=[...sections.keys()]; const index=keys.indexOf(key); const next=event.key==='Home'?0:event.key==='End'?keys.length-1:(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length; showSection(keys[next]); sections.get(keys[next]).control.focus(); });
      sections.set(key, { panel, control }); tabs.append(control); form.append(panel);
    }
    const section = key => { sectionParent = sections.get(key).panel; };
    section('run');
    textField('Name', 'name');
    const hosts = [{ value: '__local__', label: 'Local machine' }, ...[...state.hostConfigs.entries()].filter(([id]) => id !== '__local__').map(([id]) => ({ value: id, label: `SSH · ${id}` }))];
    if (!hosts.some(item => item.value === draft.host)) hosts.push({ value: draft.host, label: `SSH · ${draft.host} (unavailable)` });
    const host = select(hosts, draft.host); host.addEventListener('change', () => { draft.host = host.value; draft.tmux = false; draft.manager = 'system'; draft.environment = ''; draft.managerPath = ''; draft.interpreter = draft.type === 'python' ? 'python3' : draft.type === 'javascript' ? 'node' : '/bin/bash'; renderForm(); });
    field(sectionParent, 'Run on', host);
    const type = select([{ value: 'python', label: 'Python' }, { value: 'javascript', label: 'JavaScript' }, { value: 'shell', label: 'Shell' }], draft.type);
    type.addEventListener('change', () => { draft.type = type.value; draft.mode = 'script'; draft.manager = 'system'; draft.environment = ''; draft.managerPath = ''; draft.interpreter = draft.type === 'python' ? 'python3' : draft.type === 'javascript' ? 'node' : '/bin/bash'; renderList(); renderForm(); }); field(sectionParent, 'Type', type);
    section('environment');
    const environmentRow = document.createElement('div'); environmentRow.className = 'run-path-field';
    const discovered = select([{ value: '', label: 'Detect environments or enter paths below' }], '');
    const discoveryHint = document.createElement('small'); discoveryHint.className = 'run-hint';
    // The picker only lists environments of the selected manager, so mamba
    // never offers pyenv versions and vice versa.
    const runtimesForManager = runtimes => {
      const manager = draft.manager || 'system';
      if (manager === 'system') return runtimes.filter(runtime => (runtime.manager || 'system') === 'system');
      return runtimes.filter(runtime => runtime.manager === manager);
    };
    const fillDiscovered = () => {
      const stale = !lastDiscovery || lastDiscovery.host !== draft.host || lastDiscovery.type !== draft.type;
      const runtimes = stale ? [] : runtimesForManager(lastDiscovery.runtimes);
      const scoped = draft.manager && draft.manager !== 'system';
      discovered.replaceChildren(new Option(scoped ? `Select a ${draft.manager} environment` : 'Select a direct interpreter', ''));
      discovered.onchange = () => { const runtime = runtimes[Number(discovered.value)]; if (runtime && discovered.value !== '') { Object.assign(draft, runtime); delete draft.label; renderForm(); } };
      runtimes.forEach((runtime, index) => discovered.add(new Option(runtime.label, String(index))));
      if (stale) { discoveryHint.textContent = ''; return; }
      discoveryHint.textContent = lastDiscovery.warnings.length ? lastDiscovery.warnings.join(' · ')
        : runtimes.length ? `${runtimes.length} ${scoped ? draft.manager + ' environments' : 'direct interpreters'} found`
        : scoped ? `No ${draft.manager} environments found on this host`
        : 'No direct interpreters found on this host';
    };
    fillDiscovered();
    const detect = button('Detect', async () => {
      detect.disabled = true; discoveryHint.textContent = 'Detecting on the selected host…'; const version = discoveryVersion;
      try {
        const result = await call('discover', { host: draft.host, type: draft.type });
        if (version !== discoveryVersion) return;
        lastDiscovery = { host: draft.host, type: draft.type, runtimes: result.runtimes, warnings: result.warnings };
        fillDiscovered();
        const sessionList = form.querySelector('datalist'); if (sessionList) { sessionList.replaceChildren(); for (const name of result.tmuxSessions) sessionList.append(new Option(name, name)); }
        try {
          const scan = await call('project-scan', { host: draft.host, cwd: draft.cwd });
          if (version !== discoveryVersion) return;
          renderSuggestions(scan);
        } catch (_) { /* Suggestions are optional. */ }
      } catch (error) { discoveryHint.textContent = error.message; }
      finally { detect.disabled = false; }
    });
    environmentRow.append(discovered, detect); field(sectionParent, 'Environment', environmentRow); sectionParent.append(discoveryHint);
    suggestionBox = document.createElement('div'); sectionParent.append(suggestionBox);
    const managers = draft.type === 'python' ? ['system', 'conda', 'mamba', 'micromamba', 'pyenv'] : draft.type === 'javascript' ? ['system', 'nvm'] : ['system'];
    const manager = select(managers.map(value => ({ value, label: value === 'system' ? 'Direct interpreter' : value })), draft.manager || 'system');
    manager.addEventListener('change', () => { draft.manager = manager.value; renderForm(); }); field(sectionParent, 'Environment manager', manager);
    if (draft.manager && draft.manager !== 'system') {
      textField('Environment / version', 'environment', draft.manager === 'nvm' ? 'v22.0.0' : 'Name or absolute environment path');
      pathField(draft.manager === 'nvm' ? 'nvm initialization file' : 'Manager executable', 'managerPath');
    }
    pathField(draft.type === 'javascript' ? 'Node interpreter' : draft.type === 'shell' ? 'Shell interpreter' : 'Python interpreter', 'interpreter');
    section('run');
    const modes = draft.type === 'python' ? ['script', 'module'] : draft.type === 'javascript' ? ['script', 'module', 'npm'] : ['script', 'commands'];
    const mode = select(modes, draft.mode); mode.addEventListener('change', () => { draft.mode = mode.value; renderForm(); }); field(sectionParent, 'Run mode', mode);
    if (draft.mode === 'script') pathField('Script path', 'target');
    else if (draft.mode === 'commands') { const code = document.createElement('textarea'); code.rows = 5; code.value = draft.target; code.addEventListener('input', () => draft.target = code.value); field(sectionParent, 'Shell commands', code); }
    else textField(draft.mode === 'npm' ? 'npm script' : 'Module name', 'target', draft.mode === 'npm' ? 'dev' : draft.type === 'python' ? 'celery, uvicorn, flask…' : 'package-name');
    textField('Arguments', 'args', '', 'Use quotes for arguments containing spaces.').classList.add('run-code-field');
    pathField('Working directory', 'cwd', 'directory');
    section('environment');
    if (draft.type === 'shell') pathField('Source before running (optional)', 'sourceFile', 'file', 'For example ~/.bashrc or ~/.zshrc, read by the selected shell.');
    const envButton = button(`Edit variables… (${Object.keys(draft.env || {}).length})`, editEnv); field(sectionParent, 'Environment variables', envButton);
    const envFiles = document.createElement('textarea'); envFiles.rows = 2; envFiles.value = (draft.envFiles || []).join('\n'); envFiles.placeholder = 'One path per line';
    envFiles.addEventListener('input', () => draft.envFiles = envFiles.value.split('\n').map(s => s.trim()).filter(Boolean));
    field(sectionParent, draft.host === '__local__' ? '.env files' : 'Remote .env files', envFiles, 'Loaded in order; later files override earlier files.');
    const envTools = document.createElement('div'); envTools.className = 'run-inline-actions';
    envTools.append(button('Add file…', async () => { try { const file = await browse(draft.cwd); if (file) { draft.envFiles ||= []; draft.envFiles.push(file); renderForm(); } } catch (error) { showError(error); } }), button('Create .env file…', createEnvFile)); sectionParent.append(envTools);
    section('launch');
    const setupTitle = document.createElement('h3'); setupTitle.className = 'run-section-title'; setupTitle.textContent = 'Before launch'; sectionParent.append(setupTitle);
    if (!Array.isArray(draft.setupScripts)) draft.setupScripts = [];
    const setupRows = document.createElement('div'); setupRows.className = 'run-setup-list'; sectionParent.append(setupRows);
    draft.setupScripts.forEach((script, index) => {
      const row = document.createElement('div'); row.className = 'run-setup-row';
      const path = input(script.path, '/path/to/.autoenv.zsh'); path.setAttribute('aria-label', `Setup script ${index + 1} path`);
      path.addEventListener('input', () => script.path = path.value);
      const shell = select([{ value: 'bash', label: 'bash' }, { value: 'zsh', label: 'zsh' }], script.shell === 'zsh' ? 'zsh' : 'bash');
      shell.setAttribute('aria-label', `Setup script ${index + 1} shell`);
      shell.addEventListener('change', () => script.shell = shell.value);
      row.append(path, shell, button('−', () => { draft.setupScripts.splice(index, 1); renderForm(); }));
      setupRows.append(row);
    });
    const setupTools = document.createElement('div'); setupTools.className = 'run-inline-actions';
    setupTools.append(button('Add setup script…', async () => {
      try { const file = await browse(draft.cwd); draft.setupScripts.push({ path: file || '', shell: /\.zsh$/i.test(file || '') ? 'zsh' : 'bash' }); renderForm(); }
      catch (error) { showError(error); }
    }));
    sectionParent.append(setupTools);
    const setupHint = document.createElement('small'); setupHint.className = 'run-hint';
    setupHint.textContent = 'Optional scripts that run before launch, in the shell you pick. Variables a script exports are applied to the run; later rows override earlier ones, and variables edited above win. Add only scripts you trust.';
    sectionParent.append(setupHint);
    check(sectionParent, 'Allow multiple instances', Boolean(draft.multiInstance), value => draft.multiInstance = value);
    const portRow = document.createElement('div'); portRow.className = 'run-port-cleanup';
    const portToggle = check(portRow, 'Kill process on port before launch / restart', Boolean(draft.killPortOnLaunch), value => { draft.killPortOnLaunch = value; port.disabled = !value; });
    const port = input(draft.killPort || '', 'Port'); port.type = 'number'; port.min = '1'; port.max = '65535'; port.step = '1'; port.setAttribute('aria-label', 'Port to clear before launch'); port.disabled = !draft.killPortOnLaunch;
    port.addEventListener('input', () => { draft.killPort = port.value ? Number(port.value) : null; });
    portRow.append(port); sectionParent.append(portRow);
    const portHint = document.createElement('small'); portHint.className = 'run-hint'; portHint.textContent = 'Force-stops TCP listeners on the configuration’s host. Requires lsof. Disabled by default.'; sectionParent.append(portHint);
    if (draft.host !== '__local__') {
      const tmux = check(sectionParent, 'Run in tmux', Boolean(draft.tmux), value => { draft.tmux = value; renderForm(); }); tmux.disabled = !tmuxAvailable;
      if (!tmuxAvailable) { const hint = document.createElement('small'); hint.className = 'run-hint'; hint.textContent = 'Enable the tmux plugin in Settings to use this option.'; sectionParent.append(hint); }
      if (draft.tmux) {
        const session = textField('tmux session', 'tmuxSession', `marina-${draft.id.slice(0, 12)}`, 'Reuses the session with a dedicated window for each run. Detect lists existing sessions.');
        const options = document.createElement('datalist'); options.id = `tmux-sessions-${draft.id}`; session.setAttribute('list', options.id); sectionParent.append(options);
      }
    }
    const groups = (state.appState.tabGroups || []).filter(group =>
      (group.configurationIds || []).length || [...state.tabs.values()].some(tab => tab.groupId === group.id));
    section('projects');
    if (groups.length) {
      const title = document.createElement('div'); title.className = 'run-group-heading'; title.textContent = 'Show in projects'; sectionParent.append(title);
      const memberships = document.createElement('div'); memberships.className = 'run-group-memberships'; sectionParent.append(memberships);
      for (const group of groups) check(memberships, group.name, groupIds.includes(group.id), checked => { groupIds = checked ? [...groupIds, group.id] : groupIds.filter(id => id !== group.id); });
      const bound = groups.filter(group => groupIds.includes(group.id));
      const defaultsGroup = prefillGroup && groups.some(group => group.id === prefillGroup.id)
        ? groups.find(group => group.id === prefillGroup.id)
        : bound[0] || groups[0];
      if (!groupDefaultsCache.has(defaultsGroup.id)) {
        groupDefaultsCache.set(defaultsGroup.id, null); // Fetch-in-flight marker.
        call('group-defaults-get', { groupId: defaultsGroup.id }).then(result => {
          if (result.defaults) { groupDefaultsCache.set(defaultsGroup.id, result.defaults); renderForm(); }
        }).catch(() => {});
      }
      const defaultsActions = document.createElement('div'); defaultsActions.className = 'run-inline-actions';
      defaultsActions.append(button(`Save current values as “${defaultsGroup.name}” defaults`, async () => {
        try {
          const result = await call('group-defaults-set', {
            groupId: defaultsGroup.id, name: defaultsGroup.name,
            defaults: { cwd: draft.cwd, interpreter: draft.interpreter, manager: draft.manager, managerPath: draft.managerPath,
                        environment: draft.environment, envFiles: draft.envFiles, setupScripts: draft.setupScripts, inheritEnv: draft.inheritEnv }
          });
          groupDefaultsCache.set(defaultsGroup.id, result.defaults);
          prefillGroup = null;
          renderForm();
        } catch (error) { errorLine.textContent = error.message; }
      }, 'ghost-btn'));
      const existing = groupDefaultsCache.get(defaultsGroup.id);
      if (existing) {
        defaultsActions.append(button(`Apply “${defaultsGroup.name}” defaults`, () => { mergeDefaults(draft, existing); renderForm(); }));
        if (prefillGroup && prefillGroup.id === defaultsGroup.id) {
          const note = document.createElement('small'); note.className = 'run-hint';
          note.textContent = `Prefilled from “${defaultsGroup.name}” group defaults.`;
          defaultsActions.append(note);
        }
      }
      sectionParent.append(defaultsActions);
    }
    if (!groups.length) sectionParent.textContent = 'Open a project to assign this configuration or share its defaults.';
    showSection(activeSection);
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
  const libraryActions = document.createElement('div'); libraryActions.className = 'run-library-actions'; libraryActions.append(duplicate, remove); sidebar.append(libraryActions);
  const spacer = document.createElement('span'); spacer.style.flex = '1'; view.footer.append(spacer);
  async function cancel() { if (!dirty() || await confirmAction('Discard unsaved changes?', 'Close without saving configuration changes?', 'Discard')) view.close(); }
  view.footer.append(button('Cancel', cancel, 'ghost-btn'), button('Apply', () => save()), button('Save', () => save(true), 'run-save-primary'));
  // Override the generic dialog's Escape handler to preserve drafts.
  view.dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }, { capture: true });
  const initial = configurations.find(c => c.id === selectedId) || configurations[0];
  if (initial) await switchTo(initial); else await switchTo(newDraft(templates[0]), true);
}
