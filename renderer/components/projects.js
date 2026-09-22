import { modal, button, confirmAction, showError } from './dialog.js';
import { getActiveTab } from '../state.js';

function hostOptions(state, select, selected = '') {
  select.add(new Option('Local shell', '__local__'));
  for (const [alias] of state.hostConfigs) if (alias !== '__local__') select.add(new Option(alias, alias));
  if (selected && ![...select.options].some(option => option.value === selected)) select.add(new Option(`${selected} (not in SSH config)`, selected));
  select.value = selected || '__local__';
}
function field(labelText, element) {
  const label = document.createElement('label'); label.className = 'project-field';
  const text = document.createElement('span'); text.textContent = labelText; label.append(text, element); return label;
}
function input(value, placeholder = '') { const el = document.createElement('input'); el.value = value || ''; el.placeholder = placeholder; return el; }

export function createProjects({ state, sessionTabs, dockLayout }) {
  const currentGroup = () => state.appState?.tabGroups?.find(group => group.id === getActiveTab(state)?.groupId);
  const showTerminal = () => document.querySelector('#tool-navigation [data-view="terminal"]')?.click();
  const emit = () => window.dispatchEvent(new Event('marinashell:groups-changed'));

  function render() {
    const rail = document.getElementById('open-projects'); rail.replaceChildren();
    const active = getActiveTab(state);
    const groups = (state.appState?.tabGroups || []).filter(group => [...state.tabs.values()].some(tab => tab.groupId === group.id));
    function item(name, groupId, tabs) {
      const el = button('', () => {
        const group = groups.find(group => group.id === groupId);
        const tab = tabs.find(tab => tab.id === group?.lastActiveTabId) || tabs[0];
        if (tab) sessionTabs.setActiveSessionTab(tab.id);
        showTerminal();
      }, 'project-switch');
      const mark = document.createElement('span'); mark.className = 'project-monogram';
      mark.textContent = groupId ? name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase() : '⌘';
      const label = document.createElement('span'); label.className = 'project-label'; label.textContent = name;
      el.append(mark, label); el.title = `${name} · ${tabs.length} sessions`; el.setAttribute('aria-label', name);
      el.setAttribute('aria-pressed', String((active?.groupId || '') === groupId));
      el.dataset.projectId = groupId; el.classList.toggle('active', (active?.groupId || '') === groupId);
      el.addEventListener('contextmenu', event => { event.preventDefault(); options(groupId); }); rail.append(el);
    }
    const loose = [...state.tabs.values()].filter(tab => !tab.groupId && !tab.runOutput);
    if (loose.length) item('Scratchpad', '', loose);
    for (const group of groups) item(group.name, group.id, [...state.tabs.values()].filter(tab => tab.groupId === group.id));
    document.getElementById('project-heading').textContent = currentGroup()?.name || 'Files';
    document.getElementById('sidebar-session-label').textContent = active ? `${active.manualTitle || 'Files'} · ${active.host === '__local__' ? 'Local' : active.host || 'No connection'}` : 'Files';
    document.getElementById('sidebar').classList.toggle('session-disconnected', !active?.connected);
    const disconnect = document.getElementById('disconnect-session-btn'); disconnect.disabled = !active?.connected || active?.readOnly;
  }

  function openConnect({ reuseTab = false } = {}) {
    const target = reuseTab ? getActiveTab(state) : null;
    const view = modal('Connect to'); view.dialog.classList.add('connection-dialog');
    const host = document.createElement('select'); host.id = 'connection-choice'; hostOptions(state, host, target?.host || state.appState?.lastHost);
    const name = input(target?.manualTitle, 'Optional session name'); name.id = 'connection-name';
    const path = input(target?.currentPath || '', '/absolute/directory'); path.id = 'connection-directory';
    const hint = document.createElement('p'); hint.className = 'form-hint'; hint.textContent = 'Choose Local shell or a host from your SSH configuration. An optional directory opens as the working folder.';
    const error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role', 'alert');
    view.body.append(hint, field('Connection', host), field('Session name', name), field('Directory (optional)', path), error);
    const connect = button('Connect', async () => {
      const folder = path.value.trim();
      if (folder && (!/^(\/|[A-Za-z]:[\\/])/.test(folder) || /[\r\n\0]/.test(folder))) { error.textContent = 'Enter an absolute directory path.'; return; }
      connect.disabled = true;
      const tab = target || sessionTabs.createNewTab({ host: host.value, path: folder || '/', groupId: currentGroup()?.id || '' });
      if (name.value.trim()) tab.manualTitle = name.value.trim();
      view.close(); showTerminal();
      await sessionTabs.connectTab(tab, host.value, folder ? { restorePath: folder } : {});
      sessionTabs.renderSessionTabs(); render();
    });
    view.footer.append(button('Cancel', view.close, 'ghost-btn'), connect);
    view.body.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); connect.click(); } });
    host.focus();
  }

  function editProject(snapshot = null) {
    const view = modal(snapshot ? 'Edit project' : 'New project', { wide: true }); view.dialog.classList.add('project-editor');
    const name = input(snapshot?.name, 'Project name'); name.id = 'project-name';
    const layout = document.createElement('select'); layout.id = 'project-layout';
    for (const [value, title] of [['1x1','One terminal at a time'],['2x1','Two columns'],['1x2','Two rows'],['2x2','Four panes']]) layout.add(new Option(title, value));
    layout.value = snapshot?.layout || '1x1';
    const hint = document.createElement('p'); hint.className = 'form-hint';
    hint.textContent = snapshot ? 'Set the directories and connections used when this project next opens. Open sessions stay as they are.' : 'Each directory opens as a session. Connections can be local or on different SSH hosts.';
    const list = document.createElement('div'); list.className = 'project-entries';
    const rows = [];
    function add(entry = {}) {
      const row = document.createElement('div'); row.className = 'project-entry';
      const title = input(entry.manualTitle, 'e.g. Backend'); const host = document.createElement('select'); hostOptions(state, host, entry.host);
      const directory = input(entry.currentPath, '/absolute/directory');
      const remove = button('Remove', () => { rows.splice(rows.findIndex(item => item.row === row), 1); row.remove(); }, 'ghost-btn');
      row.append(field('Name', title), field('Connection', host), field('Directory', directory), remove);
      list.append(row); rows.push({ row, title, host, directory, initial: entry });
    }
    (snapshot?.tabs || [{ manualTitle:'Backend' }, { manualTitle:'Frontend' }, { manualTitle:'Worker' }, { manualTitle:'Docs' }]).forEach(add);
    const error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role','alert');
    const identity = document.createElement('div'); identity.className = 'project-identity'; identity.append(field('Project name', name), field('Saved layout', layout));
    view.body.append(identity, hint, list, button('Add directory', () => add(), 'ghost-btn'), error);
    async function save(andOpen) {
      if (!name.value.trim() || !rows.length) { error.textContent = 'Enter a project name and add at least one directory.'; return; }
      const tabs = rows.map(({ title, host, directory, initial }) => ({ ...initial, manualTitle: title.value.trim(), host: host.value, currentPath: directory.value.trim(), treeRootPath: directory.value.trim(), connected: !initial.readOnly }));
      if (tabs.some(tab => !tab.manualTitle || !/^(\/|[A-Za-z]:[\\/])/.test(tab.currentPath) || /[\r\n\0]/.test(tab.currentPath))) { error.textContent = 'Every directory needs a name, connection, and absolute path.'; return; }
      view.footer.querySelectorAll('button').forEach(el => { el.disabled = true; });
      try {
        const saved = await state.api.invoke('groups:save', { ...snapshot, kind: 'project', name: name.value.trim(), layout: layout.value, tabs });
        if (!saved?.id) throw new Error(saved?.error || 'The project could not be saved.');
        view.close(); emit();
        if (andOpen) { await sessionTabs.savedGroups.restore(saved); showTerminal(); }
      } catch (err) { error.textContent = err.message; view.footer.querySelectorAll('button').forEach(el => { el.disabled = false; }); }
    }
    view.footer.append(button('Cancel', view.close, 'ghost-btn'), button('Save project', () => save(false)));
    if (!snapshot) view.footer.append(button('Save and open', () => save(true), 'primary-btn'));
    name.focus();
  }

  async function openLibrary() {
    const view = modal('Open project', { wide: true }); view.dialog.classList.add('project-library');
    const search = input('', 'Find a saved project…'); search.setAttribute('aria-label', 'Find a saved project');
    const list = document.createElement('div'); view.body.append(search, list); list.textContent = 'Loading projects…';
    view.footer.append(button('Close', view.close, 'ghost-btn'), button('New project', () => { view.close(); editProject(); }, 'primary-btn'));
    try {
      let projects = await state.api.invoke('groups:list');
      function draw() {
        list.replaceChildren();
        const matches = projects.filter(project => project.name.toLowerCase().includes(search.value.toLowerCase()));
        if (!matches.length) list.textContent = projects.length ? 'No matching projects.' : 'No saved projects yet. Create one with your local and SSH directories.';
        for (const project of matches) {
          const row = document.createElement('div'); row.className = 'workspace-library-row';
          const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = project.name;
          const detail = document.createElement('small'); detail.textContent = `${project.tabs.length} directories · ${project.layout || '1x1'} · ${[...new Set(project.tabs.map(tab => tab.host === '__local__' ? 'Local' : tab.host))].join(', ')}`;
          info.append(title, detail);
          const open = button('Open', async () => { open.disabled = true; view.close(); try { await sessionTabs.savedGroups.restore(project); showTerminal(); } catch (err) { showError(err); } });
          row.append(info, open, button('Edit', () => { view.close(); editProject(project); }, 'ghost-btn'), button('Delete', async () => {
            if (!await confirmAction('Delete saved project?', `Delete “${project.name}” from the library? Its open sessions will stay open.`, 'Delete')) return;
            try { await state.api.invoke('groups:delete', project.id); projects = projects.filter(item => item.id !== project.id); draw(); } catch (err) { showError(err); }
          }, 'ghost-btn')); list.append(row);
        }
      }
      search.addEventListener('input', draw); draw(); search.focus();
    } catch (err) { list.textContent = err.message; }
  }

  async function options(groupId = currentGroup()?.id) {
    const group = state.appState.tabGroups.find(item => item.id === groupId);
    if (!group) { editProject(); return; }
    const view = modal(group.name); view.dialog.classList.add('project-options');
    const controls = document.createElement('div'); controls.className = 'project-option-actions';
    const layout = document.createElement('select'); layout.setAttribute('aria-label', 'Project layout');
    for (const [value, name] of [['1x1','One terminal'],['2x1','Two columns'],['1x2','Two rows'],['2x2','Four panes']]) layout.add(new Option(name, value));
    layout.value = group.layout || '1x1'; layout.addEventListener('change', () => sessionTabs.setGroupLayout(group.id, layout.value));
    view.body.append(field('Layout', layout));
    controls.append(button('Save current sessions and layout', async () => { view.close(); await sessionTabs.savedGroups.save(group.id, true); }), button('Edit saved setup', async () => {
      view.close(); try { const library = await state.api.invoke('groups:list'); const saved = library.find(item => item.id === group.savedGroupId);
      if (saved) editProject(saved); else editProject({ name: group.name, layout: group.layout, tabs: [...state.tabs.values()].filter(tab => tab.groupId === group.id).map(tab => ({ host: tab.host, currentPath: tab.currentPath, manualTitle: tab.manualTitle || 'Terminal' })) }); } catch (error) { showError(error); }
    }), button('Close project', async () => { view.close(); await sessionTabs.closeGroup(group.id); emit(); }, 'ghost-btn'));
    view.body.append(controls); view.footer.append(button('Done',view.close));
  }
  document.getElementById('project-add-btn').addEventListener('click', openLibrary);
  document.getElementById('open-project-btn').addEventListener('click', openLibrary);
  document.getElementById('new-project-btn').addEventListener('click', () => editProject());
  document.getElementById('open-connect-btn').addEventListener('click', () => openConnect());
  document.getElementById('project-options-btn').addEventListener('click', () => options());
  document.getElementById('disconnect-session-btn').addEventListener('click', () => sessionTabs.disconnectTab(getActiveTab(state)).catch(showError));
  const menu = document.getElementById('open-menu');
  menu.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') menu.open = false; });
  for (const event of ['marinashell:groups-changed','marinashell:active-tab-changed','marinashell:session-state-changed','marinashell:tabs-rendered']) window.addEventListener(event, render);
  window.addEventListener('marinashell:connect-request', event => openConnect(event.detail || {}));
  state.api.onOpenMenu?.(action => { if (action === 'connect') openConnect(); else if (action === 'new-project') editProject(); else openLibrary(); });
  return { render, openConnect, openLibrary, editProject, options };
}
