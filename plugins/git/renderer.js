import { mountDiff } from '../../renderer/services/diffIntegration.js';
import { registerTerminalMenuAction } from '../../renderer/services/terminalMenu.js';
import { button } from '../../renderer/components/dialog.js';
import { installOperations } from './operations-ui.js';
import { mountPullRequests } from './github-ui.js';

let activated = false;
export default function activate({ api, state, registerView, openView, dockLayout, registerCommand }) {
  if (activated) return; activated = true;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./style.css', import.meta.url).href; document.head.append(style);
  const repositories = new Map(); const pending = new Map(); const mounted = new Set();
  const key = tab => `${tab?.id}\0${tab?.host}\0${tab?.currentPath}`;
  const activeTab = () => state.tabs.get(state.activeTabId);
  async function call(name, payload) { const r = await api.invoke(`plugin:git:${name}`, payload); if (!r?.ok) throw new Error(r?.error || 'Git request failed'); return r; }
  const visible = tab => Boolean(tab?.connected && repositories.get(key(tab))?.repository);
  async function discover(tab, force = false) {
    if (!tab?.connected) return null;
    const id = key(tab); if (!force && repositories.has(id) && Date.now() - repositories.get(id).checkedAt < 5000) return repositories.get(id)?.repository;
    if (pending.has(id)) return pending.get(id);
    const operation = call('discover', { host: tab.host || '__local__', cwd: tab.currentPath, tabId: tab.id, projectId: tab.groupId || '' })
      .then(result => { repositories.set(id, { ...result, checkedAt: Date.now() }); dockLayout.refreshAvailability(); return result.repository; })
      .catch(error => { repositories.delete(id); dockLayout.refreshAvailability(); throw error; })
      .finally(() => pending.delete(id)); pending.set(id, operation); return operation;
  }
  const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
  function mount(container, options = {}) {
    let tab = options.tabId ? state.tabs.get(options.tabId) : activeTab();
    let repository; let snapshot; let selected = ''; let disposeDiff; let disposePr; let epoch = 0; let loadVersion = 0; let disposed = false;
    const root = el('section', '', 'git-workspace'); const toolbar = el('div', '', 'git-toolbar git-main-toolbar');
    installOperations(root);
    const identity = el('strong', 'Git'); const compare = el('select'); compare.setAttribute('aria-label', 'Compare against branch');
    const comparison = el('details', '', 'git-comparison git-dropdown'); const comparisonLabel = el('summary', 'Working changes');
    const comparisonOptions = el('div', '', 'git-dropdown-panel'); comparison.append(comparisonLabel, comparisonOptions);
    const search = el('input'); search.placeholder = 'Filter branches'; search.setAttribute('aria-label', 'Filter branches');
    let branchChoices = [];
    const fillBranches = () => {
      const value = compare.value; compare.replaceChildren(new Option('Working changes', ''));
      for (const branch of branchChoices.filter(b => b.toLowerCase().includes(search.value.toLowerCase()) || b === value)) compare.append(new Option(`Since merge base: ${branch}`, branch));
      compare.value = value;
    };
    const tabs = el('div', '', 'git-tabs');
    const setTab = active => { root.classList.toggle('git-showing-prs', active?.textContent === 'Pull Requests'); for (const control of tabs.children) control.setAttribute('aria-pressed', String(control === active)); };
    const diffTab = button('Diff', () => load()); const prTab = button('Pull Requests', () => {
      if (!repository) return; setTab(prTab); status.textContent = ''; epoch++; disposeDiff?.(); disposeDiff = null; disposePr?.(); disposePr = mountPullRequests(body, { repository, call, api, branch: snapshot?.branch || '', selectedBranch: compare.value || snapshot?.branch || '', branches: snapshot?.branches || [] });
    }); tabs.append(diffTab, prTab); setTab(diffTab);
    comparisonOptions.append(search, compare); toolbar.append(identity, tabs, comparison);
    const status = el('p', '', 'git-status'); status.setAttribute('role', 'status');
    const body = el('div', '', 'git-body'); const files = el('nav', '', 'git-files'); files.setAttribute('aria-label', 'Changed files'); const content = el('div', '', 'git-content');
    body.append(files, content); root.append(toolbar, status, body); container.append(root);
    const closeMenus = event => {
      for (const menu of root.querySelectorAll('.git-dropdown[open]')) if (event.key === 'Escape' || !menu.contains(event.target)) {
        menu.open = false; if (event.key === 'Escape') menu.querySelector('summary').focus();
      }
    };
    document.addEventListener('pointerdown', closeMenus); root.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(event); });
    const safe = fn => async (...args) => { try { await fn(...args); } catch (error) { status.textContent = error.message; } };
    async function select(row) {
      const token = ++epoch; selected = row.id; disposeDiff?.(); disposeDiff = null; content.replaceChildren(el('p', 'Loading diff…'));
      for (const item of files.querySelectorAll('[data-file]')) item.classList.toggle('active', item.dataset.file === row.id);
      try {
        const result = await call('content', { snapshotId: snapshot.id, fileId: row.id });
        if (disposed || token !== epoch) return;
        const title = `${row.path} · ${row.scope}`;
        content.replaceChildren();
        if (result.unavailable) { content.append(el('header', title, 'git-file-heading'), el('p', result.unavailable)); return; }
        const settings = await api.getSettings(); if (disposed || token !== epoch) return;
        const host = el('div', '', 'git-diff-host'); content.append(host);
        disposeDiff = mountDiff(host, { ...result, title, mode: settings.editor?.preferences?.diffMode?.value || 'unified', onModeChange: mode => api.invoke('settings:editor-preferences', { diffMode: mode }) });
      } catch (error) { if (!disposed && token === epoch) { content.replaceChildren(el('p', error.message)); } }
    }
    function renderFiles() {
      const heading = el('header', `${snapshot.files.length} changed ${snapshot.files.length === 1 ? 'file' : 'files'}`, 'git-files-heading'); heading.title = repository.cwd;
      const list = el('div', '', 'git-files-list'); files.replaceChildren(heading, list); let scope = '';
      for (const row of snapshot.files) {
        if (scope !== row.scope) { scope = row.scope; list.append(el('h4', scope)); }
        const control = button('', safe(() => select(row))); control.dataset.file = row.id;
        control.append(el('span', `${row.status} ${row.oldPath !== row.path ? row.oldPath + ' → ' : ''}${row.path}`), el('small', row.added == null ? 'binary / metadata' : `+${row.added}`, 'git-added'), el('small', row.deleted == null ? '' : `−${row.deleted}`, 'git-deleted'));
        control.title = row.path; list.append(control);
      }
    }
    async function load(force = false) {
      disposePr?.(); disposePr = null; setTab(diffTab); body.replaceChildren(files, content);
      const token = ++epoch; const version = ++loadVersion;
      root.setAttribute('aria-busy', 'true'); compare.disabled = true; status.textContent = 'Loading repository…';
      for (const control of root.querySelectorAll('.git-tabs button,.git-operations button')) control.disabled = true;
      try {
        const target = options.tabId ? state.tabs.get(options.tabId) : activeTab(); tab = target;
        const context = await discover(target, force); if (disposed || token !== epoch) return;
        repository = context;
        disposeDiff?.(); disposeDiff = null; files.replaceChildren(); content.replaceChildren();
        if (!context) { status.textContent = target?.connected ? 'This terminal is outside a Git worktree.' : 'Connect this terminal to view Git changes.'; return; }
        const r = await call('snapshot', { contextId: context.id, base: compare.value }); if (disposed || token !== epoch) return;
        snapshot = r; branchChoices = r.branches; fillBranches(); identity.textContent = r.branch;
        identity.title = `${context.host} · ${context.cwd}`;
        comparisonLabel.textContent = r.base ? `Since ${r.base}` : 'Working changes';
        comparisonLabel.title = r.base ? `${r.base} merge base → ${r.branch} · committed changes` : 'Compare working changes or a branch';
        status.textContent = '';
        renderFiles();
        root.dispatchEvent(new CustomEvent('git:snapshot', { bubbles: true, detail: { repository: context, snapshot, call, getSelected: () => selected, reload: () => load(), toolbar, status } }));
        const row = r.files.find(f => f.id === selected) || r.files[0]; if (row) await select(row); else content.append(el('p', 'No changes in this comparison.'));
      } catch (error) { if (!disposed && token === epoch) status.textContent = error.message; }
      finally { if (!disposed && version === loadVersion) { root.setAttribute('aria-busy', 'false'); compare.disabled = false; for (const control of tabs.querySelectorAll('button')) control.disabled = false; } }
    }
    compare.addEventListener('change', () => { comparison.open = false; load(); }); search.addEventListener('input', fillBranches);
    options.setRefresh?.(() => { if (disposePr) disposePr.refresh(); else if (root.getAttribute('aria-busy') !== 'true') load(true); });
    const view = { update: () => { if (!options.tabId) load(); } }; mounted.add(view); load();
    return () => { disposed = true; epoch++; disposeDiff?.(); disposePr?.(); document.removeEventListener('pointerdown', closeMenus); mounted.delete(view); root.remove(); };
  }
  registerView('git', { title: 'Git', iconClass: 'icon-git', supports: ['local', 'ssh'], visible, mount });
  registerTerminalMenuAction('git-diff', { title: 'Git Diff', visible, run: tab => openView('git', { tabId: tab.id }) });
  registerCommand?.('Git Diff', async () => { const tab = activeTab(); if (await discover(tab)) openView('git', { tabId: tab.id }); });
  const update = () => {
    for (const tab of state.tabs.values()) discover(tab).catch(() => {});
    for (const view of mounted) view.update(); dockLayout.refreshAvailability();
  };
  for (const event of ['marinashell:active-tab-changed', 'marinashell:session-state-changed', 'marinashell:tabs-rendered']) window.addEventListener(event, update);
  api.onSshCwd?.(() => { for (const tab of state.tabs.values()) discover(tab).catch(() => {}); });
  update();
}
