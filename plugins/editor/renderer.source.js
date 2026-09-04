import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { startCompletion } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { javascript } from '@codemirror/lang-javascript';
import { json, jsonLanguage, jsonParseLinter } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml, yamlLanguage } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';

const documents = new Map();
let unloadWarningInstalled = false;

function documentKey(file) {
  return String(file.tabId) + '\u0000' + String(file.path);
}

function fileName(file) {
  if (file.name) return file.name;
  const parts = String(file.path || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'untitled';
}

function ensureDocument(file) {
  const key = documentKey(file);
  if (!documents.has(key)) {
    documents.set(key, {
      key,
      tabId: String(file.tabId),
      path: String(file.path),
      name: fileName(file),
      host: file.host || '',
      sessionType: file.sessionType || 'ssh',
      content: '',
      savedContent: '',
      stat: null,
      loaded: false,
      loading: false,
      saving: false,
      dirty: false,
      conflict: false,
      error: '',
      eol: 'LF',
      savedEol: 'LF',
      indentStyle: 'spaces',
      indentSize: 2
    });
  }
  return documents.get(key);
}

function structuredCompletionSource(context) {
  const word = context.matchBefore(/[\w$.-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = context.state.doc.toString();
  const names = new Set();
  const keyPattern = /(?:["']?)([A-Za-z_$][\w$.-]*)(?:["']?)\s*:/g;
  let match = null;
  while ((match = keyPattern.exec(text)) && names.size < 250) names.add(match[1]);
  const options = Array.from(names, (label) => ({ label, type: 'property' }));
  options.push(
    { label: 'true', type: 'keyword' },
    { label: 'false', type: 'keyword' },
    { label: 'null', type: 'keyword' }
  );
  return { from: word.from, options, validFor: /^[\w$.-]*$/ };
}

function languageFor(name) {
  const lower = String(name || '').toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (ext === 'json' || ext === 'map') {
    return {
      label: 'JSON',
      extension: [json(), jsonLanguage.data.of({ autocomplete: structuredCompletionSource }), linter(jsonParseLinter())]
    };
  }
  if (ext === 'jsonc') {
    return { label: 'JSON with comments', extension: [json(), jsonLanguage.data.of({ autocomplete: structuredCompletionSource })] };
  }
  if (['yaml', 'yml'].includes(ext)) {
    return { label: 'YAML', extension: [yaml(), yamlLanguage.data.of({ autocomplete: structuredCompletionSource })] };
  }
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) {
    return { label: ext === 'jsx' ? 'JavaScript JSX' : 'JavaScript', extension: javascript({ jsx: ext === 'jsx' }) };
  }
  if (['ts', 'mts', 'cts', 'tsx'].includes(ext)) {
    return { label: ext === 'tsx' ? 'TypeScript JSX' : 'TypeScript', extension: javascript({ typescript: true, jsx: ext === 'tsx' }) };
  }
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return { label: 'HTML', extension: html() };
  if (['css', 'scss', 'less'].includes(ext)) return { label: 'CSS', extension: css() };
  if (['md', 'mdx', 'markdown'].includes(ext)) return { label: 'Markdown', extension: markdown() };
  if (['py', 'pyw'].includes(ext)) return { label: 'Python', extension: python() };
  return { label: ext ? ext.toUpperCase() : 'Plain text', extension: [] };
}

function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

function detectLineEnding(content) {
  if (String(content || '').includes('\r\n')) return 'CRLF';
  if (String(content || '').includes('\r')) return 'CR';
  return 'LF';
}

function serializeLineEndings(content, eol) {
  const normalized = normalizeLineEndings(content);
  if (eol === 'CRLF') return normalized.replace(/\n/g, '\r\n');
  if (eol === 'CR') return normalized.replace(/\n/g, '\r');
  return normalized;
}

function greatestCommonDivisor(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left;
}

function detectIndentation(content) {
  const lines = normalizeLineEndings(content).split('\n').slice(0, 1000);
  let tabLines = 0;
  const spaceWidths = [];
  for (const line of lines) {
    if (/^\t+\S/.test(line)) tabLines += 1;
    const match = /^( +)\S/.exec(line);
    if (match) spaceWidths.push(match[1].length);
  }
  if (tabLines > spaceWidths.length) return { style: 'tabs', size: 4 };
  const width = spaceWidths.reduce((result, value) => greatestCommonDivisor(result, value), 0);
  return { style: 'spaces', size: [2, 4, 8].includes(width) ? width : 2 };
}

function updateDirty(doc) {
  doc.dirty = doc.content !== doc.savedContent || doc.eol !== doc.savedEol;
  return doc.dirty;
}

function indentationExtension(doc) {
  const value = doc.indentStyle === 'tabs' ? '\t' : ' '.repeat(doc.indentSize || 2);
  return [indentUnit.of(value), EditorState.tabSize.of(doc.indentSize || 4)];
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function installStyles() {
  if (document.getElementById('marinashell-editor-styles')) return;
  const link = document.createElement('link');
  link.id = 'marinashell-editor-styles';
  link.rel = 'stylesheet';
  link.href = new URL('./editor.css', import.meta.url).href;
  document.head.appendChild(link);
}

function button(label, className, title) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className || 'mse-button';
  el.textContent = label;
  if (title) el.title = title;
  return el;
}

function createWorkspace(container, options, api) {
  const shortcutModifier = navigator.platform && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const root = document.createElement('section');
  root.className = 'mse-workspace';

  const tabStrip = document.createElement('div');
  tabStrip.className = 'mse-tabs';

  const toolbar = document.createElement('div');
  toolbar.className = 'mse-toolbar';
  const identity = document.createElement('div');
  identity.className = 'mse-identity';
  const fileTitle = document.createElement('strong');
  const filePath = document.createElement('span');
  identity.append(fileTitle, filePath);
  const actions = document.createElement('div');
  actions.className = 'mse-actions';
  const suggestButton = button('Suggest', 'mse-button', 'Show completions (Ctrl+Space)');
  const reloadButton = button('Reload', 'mse-button', 'Reload from disk');
  const saveButton = button('Save', 'mse-button mse-button-primary', 'Save (⌘/Ctrl+S)');
  actions.append(suggestButton, reloadButton, saveButton);
  toolbar.append(identity, actions);

  const conflict = document.createElement('div');
  conflict.className = 'mse-conflict';
  const conflictText = document.createElement('span');
  conflictText.textContent = 'This file changed outside MarinaShell.';
  const conflictActions = document.createElement('div');
  const discardButton = button('Load remote', 'mse-button');
  const overwriteButton = button('Overwrite', 'mse-button mse-button-danger');
  conflictActions.append(discardButton, overwriteButton);
  conflict.append(conflictText, conflictActions);

  const stage = document.createElement('div');
  stage.className = 'mse-stage';
  const editorHost = document.createElement('div');
  editorHost.className = 'mse-editor-host';
  const empty = document.createElement('div');
  empty.className = 'mse-empty';
  stage.append(editorHost, empty);

  const status = document.createElement('div');
  status.className = 'mse-status';
  const statusMessage = document.createElement('span');
  const statusMeta = document.createElement('div');
  statusMeta.className = 'mse-status-meta';
  const languageStatus = document.createElement('span');
  const indentStatus = button('', 'mse-status-button', 'Choose indentation used for new lines');
  const eolStatus = button('', 'mse-status-button', 'Choose line ending');
  const cursorStatus = document.createElement('span');
  statusMeta.append(languageStatus, indentStatus, eolStatus, cursorStatus);
  status.append(statusMessage, statusMeta);

  const contextMenu = document.createElement('nav');
  contextMenu.className = 'mse-context-menu';
  contextMenu.setAttribute('aria-label', 'Editor actions');

  root.append(tabStrip, toolbar, conflict, stage, status, contextMenu);
  container.appendChild(root);

  let activeKey = null;
  let view = null;
  let disposed = false;
  let indentationCompartment = null;

  function activeDocument() {
    return activeKey ? documents.get(activeKey) || null : null;
  }

  function updateCursor() {
    const doc = activeDocument();
    if (!doc || !view) {
      cursorStatus.textContent = '';
      return;
    }
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    cursorStatus.textContent = 'Ln ' + line.number + ', Col ' + (head - line.from + 1);
  }

  function renderTabs() {
    tabStrip.innerHTML = '';
    if (!documents.size) {
      const label = document.createElement('span');
      label.className = 'mse-tabs-empty';
      label.textContent = 'No open files';
      tabStrip.appendChild(label);
      return;
    }
    for (const doc of documents.values()) {
      const tab = button('', 'mse-tab');
      tab.classList.toggle('active', doc.key === activeKey);
      const dot = document.createElement('span');
      dot.className = 'mse-dirty-dot';
      dot.textContent = doc.dirty ? '●' : '';
      const label = document.createElement('span');
      label.className = 'mse-tab-name';
      label.textContent = doc.name;
      const close = document.createElement('span');
      close.className = 'mse-tab-close';
      close.textContent = '×';
      close.title = 'Close file';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeDocument(doc.key);
      });
      tab.append(dot, label, close);
      tab.title = doc.path;
      tab.addEventListener('click', () => activateDocument(doc.key));
      tabStrip.appendChild(tab);
    }
  }

  function renderChrome() {
    const doc = activeDocument();
    renderTabs();
    toolbar.hidden = !doc;
    status.hidden = !doc;
    conflict.classList.toggle('visible', Boolean(doc && doc.conflict));
    if (!doc) return;
    fileTitle.textContent = doc.name + (doc.dirty ? ' •' : '');
    filePath.textContent = doc.path;
    saveButton.disabled = doc.loading || doc.saving || !doc.loaded || !doc.dirty;
    saveButton.textContent = doc.saving ? 'Saving…' : 'Save';
    reloadButton.disabled = doc.loading || doc.saving;
    suggestButton.disabled = doc.loading || !doc.loaded || !view;
    languageStatus.textContent = languageFor(doc.name).label;
    indentStatus.textContent = doc.indentStyle === 'tabs'
      ? 'Tabs: ' + doc.indentSize
      : 'Spaces: ' + doc.indentSize;
    eolStatus.textContent = doc.eol;
    if (doc.error) statusMessage.textContent = doc.error;
    else if (doc.loading) statusMessage.textContent = 'Loading from ' + (doc.sessionType === 'local' ? 'disk' : doc.host || 'remote host') + '…';
    else if (doc.saving) statusMessage.textContent = 'Saving safely…';
    else if (doc.dirty) statusMessage.textContent = 'Unsaved changes';
    else statusMessage.textContent = 'Saved · UTF-8 · ' + formatBytes(new Blob([doc.content]).size);
    statusMessage.classList.toggle('error', Boolean(doc.error));
    updateCursor();
  }

  function showEmpty(kind, message) {
    empty.innerHTML = '';
    empty.className = 'mse-empty visible ' + (kind || '');
    const mark = document.createElement('div');
    mark.className = 'mse-empty-mark';
    mark.textContent = kind === 'error' ? '!' : kind === 'loading' ? '···' : '</>';
    const heading = document.createElement('strong');
    heading.textContent = kind === 'error' ? 'Could not open file' : kind === 'loading' ? 'Opening file' : 'Inline editor ready';
    const copy = document.createElement('span');
    copy.textContent = message;
    empty.append(mark, heading, copy);
    if (kind === 'error') {
      const retry = button('Try again', 'mse-button');
      retry.addEventListener('click', () => loadActive(true));
      empty.appendChild(retry);
    }
  }

  function hideContextMenu() {
    contextMenu.classList.remove('visible');
    contextMenu.innerHTML = '';
  }

  function positionContextMenu(x, y) {
    contextMenu.style.left = Math.max(8, x) + 'px';
    contextMenu.style.top = Math.max(8, y) + 'px';
    contextMenu.classList.add('visible');
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    contextMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  }

  function showActionMenu(items, x, y) {
    hideContextMenu();
    for (const item of items) {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.className = 'mse-menu-separator';
        contextMenu.appendChild(separator);
        continue;
      }
      const action = button('', 'mse-menu-item');
      action.disabled = Boolean(item.disabled);
      const check = document.createElement('span');
      check.className = 'mse-menu-check';
      check.textContent = item.checked ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'mse-menu-label';
      label.textContent = item.label;
      const shortcut = document.createElement('span');
      shortcut.className = 'mse-menu-shortcut';
      shortcut.textContent = item.shortcut || '';
      action.append(check, label, shortcut);
      action.addEventListener('click', async () => {
        if (action.disabled) return;
        hideContextMenu();
        await item.run();
        if (view) view.focus();
      });
      contextMenu.appendChild(action);
      if (item.onCreate) item.onCreate(action);
    }
    positionContextMenu(x, y);
  }

  function selectedText() {
    if (!view) return '';
    const range = view.state.selection.main;
    return range.empty ? '' : view.state.sliceDoc(range.from, range.to);
  }

  async function copySelection() {
    const text = selectedText();
    if (text) await api.copyToClipboard(text);
  }

  async function cutSelection() {
    if (!view || !selectedText()) return;
    await copySelection();
    view.dispatch(view.state.replaceSelection(''));
  }

  async function pasteClipboard(text) {
    if (!view || !text) return;
    view.dispatch(view.state.replaceSelection(normalizeLineEndings(text)));
  }

  function deleteSelection() {
    if (!view || !selectedText()) return;
    view.dispatch(view.state.replaceSelection(''));
  }

  function selectAll() {
    if (!view) return;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  }

  function showEditorContextMenu(event) {
    if (!view) return;
    event.preventDefault();
    event.stopPropagation();
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = view.state.selection.main;
    if (position != null && (selection.empty || position < selection.from || position > selection.to)) {
      view.dispatch({ selection: { anchor: position } });
    }
    const hasSelection = Boolean(selectedText());
    let pasteButton = null;
    let clipboardText = '';
    showActionMenu([
      { label: 'Cut', shortcut: shortcutModifier + 'X', disabled: !hasSelection, run: cutSelection },
      { label: 'Copy', shortcut: shortcutModifier + 'C', disabled: !hasSelection, run: copySelection },
      {
        label: 'Paste',
        shortcut: shortcutModifier + 'V',
        disabled: true,
        run: () => pasteClipboard(clipboardText),
        onCreate: (item) => { pasteButton = item; }
      },
      { label: 'Delete', disabled: !hasSelection, run: deleteSelection },
      { separator: true },
      { label: 'Select all', shortcut: shortcutModifier + 'A', run: selectAll }
    ], event.clientX, event.clientY);
    Promise.resolve(api.readClipboard()).then((text) => {
      clipboardText = typeof text === 'string' ? text : '';
      if (pasteButton && contextMenu.classList.contains('visible')) pasteButton.disabled = !clipboardText;
    }).catch(() => {});
  }

  function setIndentation(style, size) {
    const doc = activeDocument();
    if (!doc) return;
    doc.indentStyle = style;
    doc.indentSize = size;
    if (view && indentationCompartment) {
      view.dispatch({ effects: indentationCompartment.reconfigure(indentationExtension(doc)) });
    }
    renderChrome();
  }

  function setLineEnding(eol) {
    const doc = activeDocument();
    if (!doc || doc.eol === eol) return;
    doc.eol = eol;
    updateDirty(doc);
    renderChrome();
  }

  function destroyView() {
    if (!view) return;
    const doc = activeDocument();
    if (doc) doc.content = view.state.doc.toString();
    view.destroy();
    view = null;
    indentationCompartment = null;
    editorHost.innerHTML = '';
  }

  function mountEditor(doc) {
    destroyView();
    empty.className = 'mse-empty';
    empty.innerHTML = '';
    const language = languageFor(doc.name);
    indentationCompartment = new Compartment();
    const saveKeymap = keymap.of([
      indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => { saveActive(false); return true; } }
    ]);
    view = new EditorView({
      state: EditorState.create({
        doc: doc.content,
        extensions: [
          basicSetup,
          oneDark,
          language.extension,
          indentationCompartment.of(indentationExtension(doc)),
          saveKeymap,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const wasDirty = doc.dirty;
              doc.content = update.state.doc.toString();
              updateDirty(doc);
              doc.error = '';
              if (wasDirty !== doc.dirty) renderChrome();
            }
            if (update.docChanged || update.selectionSet) updateCursor();
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }
          })
        ]
      }),
      parent: editorHost
    });
    requestAnimationFrame(() => view && view.focus());
    renderChrome();
  }

  async function loadActive(force) {
    const doc = activeDocument();
    if (!doc || doc.loading) return;
    if (!force && doc.loaded) {
      mountEditor(doc);
      return;
    }
    doc.loading = true;
    doc.error = '';
    doc.conflict = false;
    destroyView();
    showEmpty('loading', doc.path);
    renderChrome();
    const requestedKey = doc.key;
    try {
      const result = await api.invoke('plugin:editor:read', { tabId: doc.tabId, path: doc.path });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'Read failed');
      const indentation = detectIndentation(result.content);
      doc.eol = detectLineEnding(result.content);
      doc.savedEol = doc.eol;
      doc.indentStyle = indentation.style;
      doc.indentSize = indentation.size;
      doc.content = normalizeLineEndings(result.content);
      doc.savedContent = doc.content;
      doc.stat = result.stat || null;
      doc.loaded = true;
      doc.dirty = false;
    } catch (err) {
      doc.error = err && err.message ? err.message : 'Read failed';
    } finally {
      doc.loading = false;
    }
    if (disposed || requestedKey !== activeKey) return;
    renderChrome();
    if (doc.error) showEmpty('error', doc.error);
    else mountEditor(doc);
  }

  async function saveActive(force) {
    const doc = activeDocument();
    if (!doc || doc.loading || doc.saving || !doc.loaded) return;
    if (view) doc.content = view.state.doc.toString();
    const savingContent = doc.content;
    const savingEol = doc.eol;
    doc.saving = true;
    doc.error = '';
    doc.conflict = false;
    renderChrome();
    try {
      const result = await api.invoke('plugin:editor:save', {
        tabId: doc.tabId,
        path: doc.path,
        content: serializeLineEndings(savingContent, savingEol),
        expectedStat: doc.stat,
        force: Boolean(force)
      });
      if (result && result.conflict) {
        doc.conflict = true;
        return;
      }
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'Save failed');
      doc.savedContent = savingContent;
      doc.savedEol = savingEol;
      doc.stat = result.stat || doc.stat;
      updateDirty(doc);
    } catch (err) {
      doc.error = err && err.message ? err.message : 'Save failed';
    } finally {
      doc.saving = false;
      if (!disposed) renderChrome();
    }
  }

  function activateDocument(key) {
    if (!documents.has(key)) return;
    destroyView();
    activeKey = key;
    renderChrome();
    const doc = activeDocument();
    if (doc.error && !doc.loaded) showEmpty('error', doc.error);
    else loadActive(false);
  }

  function closeDocument(key) {
    const doc = documents.get(key);
    if (!doc) return;
    if (doc.dirty && !window.confirm('Close ' + doc.name + ' and discard unsaved changes?')) return;
    const keys = Array.from(documents.keys());
    const index = keys.indexOf(key);
    documents.delete(key);
    if (key !== activeKey) {
      renderChrome();
      return;
    }
    destroyView();
    const remaining = Array.from(documents.keys());
    activeKey = remaining[Math.min(index, remaining.length - 1)] || null;
    renderChrome();
    if (activeKey) loadActive(false);
    else showEmpty('', 'Open a file from the Files panel to begin.');
  }

  reloadButton.addEventListener('click', () => {
    const doc = activeDocument();
    if (!doc) return;
    if (doc.dirty && !window.confirm('Reload ' + doc.name + ' and discard unsaved changes?')) return;
    loadActive(true);
  });
  suggestButton.addEventListener('click', () => {
    if (view) {
      view.focus();
      startCompletion(view);
    }
  });
  saveButton.addEventListener('click', () => saveActive(false));
  discardButton.addEventListener('click', () => loadActive(true));
  overwriteButton.addEventListener('click', () => saveActive(true));
  editorHost.addEventListener('contextmenu', showEditorContextMenu);
  indentStatus.addEventListener('click', (event) => {
    const doc = activeDocument();
    if (!doc) return;
    const rect = event.currentTarget.getBoundingClientRect();
    showActionMenu([
      { label: 'Spaces: 2', checked: doc.indentStyle === 'spaces' && doc.indentSize === 2, run: () => setIndentation('spaces', 2) },
      { label: 'Spaces: 4', checked: doc.indentStyle === 'spaces' && doc.indentSize === 4, run: () => setIndentation('spaces', 4) },
      { label: 'Spaces: 8', checked: doc.indentStyle === 'spaces' && doc.indentSize === 8, run: () => setIndentation('spaces', 8) },
      { separator: true },
      { label: 'Tabs: 2 columns', checked: doc.indentStyle === 'tabs' && doc.indentSize === 2, run: () => setIndentation('tabs', 2) },
      { label: 'Tabs: 4 columns', checked: doc.indentStyle === 'tabs' && doc.indentSize === 4, run: () => setIndentation('tabs', 4) },
      { label: 'Tabs: 8 columns', checked: doc.indentStyle === 'tabs' && doc.indentSize === 8, run: () => setIndentation('tabs', 8) }
    ], rect.left, rect.top - 8);
  });
  eolStatus.addEventListener('click', (event) => {
    const doc = activeDocument();
    if (!doc) return;
    const rect = event.currentTarget.getBoundingClientRect();
    showActionMenu([
      { label: 'LF', checked: doc.eol === 'LF', run: () => setLineEnding('LF') },
      { label: 'CRLF', checked: doc.eol === 'CRLF', run: () => setLineEnding('CRLF') },
      { label: 'CR', checked: doc.eol === 'CR', run: () => setLineEnding('CR') }
    ], rect.left, rect.top - 8);
  });

  const dismissContextMenu = (event) => {
    if (!contextMenu.contains(event.target)) hideContextMenu();
  };
  document.addEventListener('pointerdown', dismissContextMenu, true);
  window.addEventListener('blur', hideContextMenu);

  if (options && typeof options.setRefresh === 'function') {
    options.setRefresh(() => {
      const doc = activeDocument();
      if (!doc || !doc.dirty || window.confirm('Reload and discard unsaved changes?')) loadActive(true);
    });
  }

  if (options && options.file) {
    const doc = ensureDocument(options.file);
    activeKey = doc.key;
  } else {
    activeKey = documents.keys().next().value || null;
  }
  renderChrome();
  if (activeKey) loadActive(false);
  else showEmpty('', 'Open a file from the Files panel to begin.');

  return () => {
    disposed = true;
    document.removeEventListener('pointerdown', dismissContextMenu, true);
    window.removeEventListener('blur', hideContextMenu);
    destroyView();
  };
}

export default function activate(context) {
  installStyles();
  const { api, openView, registerEditorMode, registerView } = context;
  if (typeof registerView !== 'function' || typeof registerEditorMode !== 'function' || typeof openView !== 'function') {
    console.error('[Editor plugin] MarinaShell editor plugin API is unavailable');
    return;
  }

  if (!unloadWarningInstalled) {
    window.addEventListener('beforeunload', (event) => {
      if (![...documents.values()].some((doc) => doc.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    });
    unloadWarningInstalled = true;
  }

  registerView('editor', {
    title: 'Editor',
    iconClass: 'icon-code',
    supports: ['ssh', 'local'],
    mount: (container, options) => createWorkspace(container, options || {}, api)
  });

  registerEditorMode('inline-editor', async ({ tab, fileInfo, context: fileContext }) => {
    openView('editor', {
      file: {
        tabId: tab.id,
        path: fileContext.path,
        name: fileInfo.name || fileContext.name,
        host: fileContext.host || tab.host,
        sessionType: tab.sessionType || 'ssh'
      }
    });
  });
}
