import { button, modal } from '../../renderer/components/dialog.js';
import { mountDiff } from '../../renderer/services/diffIntegration.js';
const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
export function mountPullRequests(container, { repository, call, api, branch, selectedBranch = branch, branches = [] }) {
  const root = el('section', '', 'git-prs'); const toolbar = el('div', '', 'git-toolbar git-pr-toolbar');
  const dropdown = (label, cls) => {
    const menu = el('details', '', `git-dropdown ${cls}`); const summary = el('summary', label); const panel = el('div', '', 'git-dropdown-panel');
    menu.append(summary, panel); return { menu, summary, panel };
  };
  const picker = dropdown('Select pull request', 'git-pr-picker'); picker.summary.setAttribute('aria-label', 'Select pull request');
  const connection = dropdown('Repository', 'git-pr-connection'); connection.summary.setAttribute('aria-label', 'GitHub repository and account');
  const branchMenu = dropdown('Branch', 'git-pr-branch');
  const remote = el('select'); remote.setAttribute('aria-label', 'GitHub remote');
  const account = el('select'); account.setAttribute('aria-label', 'Project GitHub account');
  const query = el('input'); query.placeholder = 'Search pull requests'; query.setAttribute('aria-label', 'Search pull requests');
  const search = el('div', '', 'git-pr-search'); search.append(query, button('Search', () => loadList()));
  const listCount = el('span', '', 'git-pr-count'); const list = el('nav', '', 'git-pr-list'); list.setAttribute('aria-label', 'Pull requests');
  picker.panel.append(search, listCount, list);
  const field = (label, input) => { const row = el('label', label, 'git-dropdown-field'); row.append(input); return row; };
  connection.panel.append(field('Remote', remote), field('GitHub account', account));
  const browserBranch = el('select'); browserBranch.setAttribute('aria-label', 'Branch in browser');
  for (const value of new Set([selectedBranch, branch, ...branches].filter(value => value && value !== 'Detached HEAD'))) browserBranch.append(new Option(value, value));
  browserBranch.value = selectedBranch;
  let remoteNames = []; let prs = []; let currentPr; let selectedNumber;
  const loadedReviews = new Map();
  const status = el('p', '', 'git-status'); status.setAttribute('role', 'status'); const review = el('div', '', 'git-pr-review');
  const openPr = button('Open PR ↗', () => safe(() => openUrl(currentPr.url))); openPr.setAttribute('aria-label', 'Open PR in browser'); openPr.disabled = true;
  branchMenu.panel.append(field('Branch', browserBranch), button('Open branch in browser', () => safe(async () => {
    let name = browserBranch.value; const trackingRemote = remoteNames.find(value => name.startsWith(value + '/')); if (trackingRemote) name = name.slice(trackingRemote.length + 1);
    const result = await request('github-branch-url', { branch: name }); await openUrl(result.url); branchMenu.menu.open = false;
  })));
  toolbar.append(picker.menu, connection.menu, branchMenu.menu, button('New PR', () => create()), openPr);
  root.append(toolbar, status, review); container.replaceChildren(root);
  let disposed = false; let epoch = 0; let listEpoch = 0; let connectionEpoch = 0; let disposeDiff; let available = false;
  const safe = async fn => { try { await fn(); } catch (error) { if (!disposed) { status.textContent = error.message; if (picker.menu.open && !list.children.length) listCount.textContent = error.message; } } };
  const request = (name, payload = {}) => call(name, { contextId: repository.id, remote: remote.value, ...payload });
  const openUrl = async value => { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid browser URL'); await api.openExternal(url.href); };
  const clearReview = () => { epoch++; disposeDiff?.(); disposeDiff = null; currentPr = null; openPr.disabled = true; review.replaceChildren(); };
  function markSelection() {
    for (const control of list.querySelectorAll('button')) {
      const active = control.dataset.pr === String(selectedNumber); control.classList.toggle('active', active); control.setAttribute('aria-current', String(active));
    }
  }
  async function showFile(target, read, content) {
    const token = ++epoch;
    const loading = setTimeout(() => { if (!disposed && token === epoch) status.textContent = 'Loading PR file…'; }, 150);
    let data;
    try { data = await read(); } finally { clearTimeout(loading); }
    if (disposed || token !== epoch) return;
    status.textContent = '';
    disposeDiff?.(); disposeDiff = null; content.replaceChildren();
    for (const control of review.querySelectorAll('[data-file]')) control.classList.toggle('active', control.dataset.file === target.id);
    if (data.unavailable) { content.append(el('header', target.path, 'git-file-heading'), el('p', data.unavailable)); return; }
    const host = el('div', '', 'git-diff-host'); content.append(host); const settings = await api.getSettings(); if (disposed || token !== epoch) return;
    disposeDiff = mountDiff(host, { ...data, title: target.path, mode: settings.editor?.preferences?.diffMode?.value || 'unified', onModeChange: mode => api.invoke('settings:editor-preferences', { diffMode: mode }) });
  }
  async function showReview(pr) {
    clearReview(); const token = epoch; selectedNumber = pr.number; markSelection(); picker.menu.open = false;
    picker.summary.textContent = `#${pr.number} ${pr.title}`; picker.summary.title = `${pr.state} · ${pr.headRefName} → ${pr.baseRefName}`;
    status.textContent = 'Loading pull request…';
    await safe(async () => {
      const key = JSON.stringify([remote.value, account.value, pr.number]);
      if (!loadedReviews.has(key)) {
        const pending = request('github-review', { number: pr.number }); loadedReviews.set(key, pending);
        pending.catch(() => { if (loadedReviews.get(key) === pending) loadedReviews.delete(key); });
        if (loadedReviews.size > 16) loadedReviews.delete(loadedReviews.keys().next().value);
      }
      const data = await loadedReviews.get(key); if (disposed || token !== epoch) return;
      currentPr = data; openPr.disabled = false; openPr.title = `Open #${data.number} in browser`;
      picker.summary.title = `#${data.number} ${data.title}\n${data.author} · ${data.state} · ${data.head} → ${data.base}`;
      const body = el('div', '', 'git-body'); const files = el('nav', '', 'git-files'); files.setAttribute('aria-label', 'Pull request changed files'); const content = el('div', '', 'git-content');
      const heading = el('header', `${data.files.length} changed ${data.files.length === 1 ? 'file' : 'files'}`, 'git-files-heading'); heading.title = picker.summary.title;
      const fileList = el('div', '', 'git-files-list'); files.append(heading, fileList); body.append(files, content); review.replaceChildren(body); status.textContent = '';
      for (const row of data.files) {
        const control = button('', () => safe(() => showFile(row, () => request('github-content', { reviewId: data.reviewId, fileId: row.id }), content)));
        control.dataset.file = row.id; control.title = row.path;
        control.append(el('span', row.path), el('small', `+${row.added}`, 'git-added'), el('small', `−${row.deleted}`, 'git-deleted')); fileList.append(control);
      }
      if (data.files[0]) await showFile(data.files[0], () => request('github-content', { reviewId: data.reviewId, fileId: data.files[0].id }), content);
      else content.append(el('p', 'No changed files in this pull request.'));
    });
  }
  async function loadList() {
    const token = ++listEpoch; clearReview(); list.replaceChildren(); listCount.textContent = ''; picker.summary.textContent = 'Select pull request';
    await safe(async () => {
      if (!available) return; status.textContent = 'Loading pull requests…';
      const data = await request('github-list', { query: query.value }); if (disposed || token !== listEpoch) return;
      prs = data.prs; listCount.textContent = `${prs.length} pull ${prs.length === 1 ? 'request' : 'requests'}`;
      for (const pr of prs) {
        const control = button('', () => showReview(pr)); control.dataset.pr = pr.number;
        control.append(el('span', `#${pr.number} ${pr.title}`), el('small', `${pr.state} · ${pr.headRefName} → ${pr.baseRefName}`));
        control.title = `#${pr.number} ${pr.title} · ${pr.state} · ${pr.headRefName} → ${pr.baseRefName}`; list.append(control);
      }
      status.textContent = prs.length ? '' : 'No matching pull requests';
      if (prs[0]) await showReview(prs.find(pr => pr.number === selectedNumber) || prs.find(pr => pr.headRefName === branch) || prs[0]);
      else picker.summary.textContent = 'No pull requests';
    });
  }
  async function refresh() {
    loadedReviews.clear();
    const token = ++connectionEpoch; listEpoch++; clearReview(); available = false; account.disabled = true; list.replaceChildren(); listCount.textContent = ''; picker.summary.textContent = 'Select pull request';
    status.textContent = 'Loading GitHub repository…';
    await safe(async () => {
      const data = await request('github-status'); if (disposed || token !== connectionEpoch) return;
      const selected = data.remote; remote.replaceChildren(); for (const repo of data.remotes) remote.append(new Option(`${repo.name} · ${repo.hostname}/${repo.repo}`, repo.name)); remote.value = selected || '';
      remoteNames = data.remotes.map(repo => repo.name);
      account.replaceChildren(new Option('Use CLI default account', '')); for (const item of data.accounts || []) account.append(new Option(`${item.login}${item.active ? ' (CLI active)' : ''}`, item.login)); account.value = data.account || ''; account.disabled = !data.available;
      connection.summary.textContent = remote.value || 'Repository'; connection.summary.title = `${remote.selectedOptions[0]?.textContent || 'GitHub repository'} · ${account.selectedOptions[0].textContent}`;
      available = data.available; status.textContent = data.error || ''; if (available) await loadList();
    });
  }
  async function create() {
    if (!available) { status.textContent = 'Configure GitHub CLI authentication before creating a PR'; return; }
    const view = modal('Create pull request', { wide: true }); const fields = {};
    for (const [key, label, initial] of [['title', 'Title', ''], ['body', 'Description', ''], ['base', 'Base branch', 'main'], ['head', 'Head branch', branch], ['headRemote', 'Head remote', remote.value]]) {
      const row = el('label', label, 'git-form-field'); const control = el(key === 'body' ? 'textarea' : 'input'); control.value = initial; row.append(control); view.body.append(row); fields[key] = control;
    }
    const draft = el('input'); draft.type = 'checkbox'; const draftRow = el('label', 'Draft'); draftRow.append(draft); view.body.append(draftRow);
    const message = el('p'); message.setAttribute('role', 'status'); const preview = el('div', '', 'git-pr-preview'); view.body.append(message, preview);
    const requestId = crypto.randomUUID(); let previewCleanup;
    view.dialog.addEventListener('close', () => previewCleanup?.());
    view.footer.append(button('Cancel', view.close), button('Preview diff', () => safe(async () => {
      try {
        const data = await request('snapshot', { base: fields.base.value }); preview.replaceChildren();
        for (const row of data.files) preview.append(button(row.path, async () => {
          try { const result = await request('content', { snapshotId: data.id, fileId: row.id }); previewCleanup?.(); const host = el('div', '', 'git-pr-preview-diff'); preview.append(host); if (result.unavailable) host.textContent = result.unavailable; else previewCleanup = mountDiff(host, result); } catch (error) { message.textContent = error.message; }
        })); message.textContent = `${data.files.length} files since ${fields.base.value} merge base`;
      } catch (error) { message.textContent = error.message; }
    })), button('Create PR', async event => {
      const control = event.currentTarget; control.disabled = true;
      try { const result = await request('github-create', { input: { ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])), draft: draft.checked, requestId } }); message.textContent = result.existing ? 'Existing PR found' : 'PR created'; view.close(); loadedReviews.clear(); await loadList(); }
      catch (error) { message.textContent = error.message; }
      finally { control.disabled = false; }
    }));
  }
  remote.addEventListener('change', () => { selectedNumber = null; connection.menu.open = false; refresh(); });
  account.addEventListener('change', () => safe(async () => {
    const token = ++connectionEpoch; listEpoch++; loadedReviews.clear(); clearReview(); available = false; list.replaceChildren(); status.textContent = 'Switching GitHub account…';
    await request('github-account', { account: account.value }); if (disposed || token !== connectionEpoch) return;
    connection.menu.open = false; selectedNumber = null; await refresh();
  }));
  query.addEventListener('keydown', event => { if (event.key === 'Enter') loadList(); }); refresh();
  const cleanup = () => { disposed = true; epoch++; listEpoch++; connectionEpoch++; loadedReviews.clear(); disposeDiff?.(); root.remove(); };
  cleanup.refresh = refresh;
  return cleanup;
}
