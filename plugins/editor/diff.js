import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { MergeView, unifiedMergeView, getChunks } from '@codemirror/merge';
import { oneDark } from '@codemirror/theme-one-dark';

export function mountReadOnlyDiff(container, { oldText, newText, title = '', mode = 'unified', language = [], onModeChange = () => {} }) {
  const root = document.createElement('section'); root.className = 'mse-diff';
  const toolbar = document.createElement('div'); toolbar.className = 'mse-diff-toolbar';
  const host = document.createElement('div'); host.className = 'mse-diff-content';
  const choice = document.createElement('select'); choice.setAttribute('aria-label', 'Diff view mode');
  choice.append(new Option('Unified', 'unified'), new Option('Split', 'split')); choice.value = mode;
  const previous = document.createElement('button'); previous.textContent = '↑'; previous.title = 'Previous change (Alt+ArrowUp)'; previous.setAttribute('aria-label', 'Previous change');
  const next = document.createElement('button'); next.textContent = '↓'; next.title = 'Next change (Alt+ArrowDown)'; next.setAttribute('aria-label', 'Next change');
  const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
  if (title) {
    const heading = document.createElement('span'); heading.className = 'mse-diff-title'; heading.textContent = title; heading.title = title;
    toolbar.append(heading);
  }
  toolbar.append(choice, previous, next, count); root.append(toolbar, host); container.append(root);
  let merge; let view; let chunks = []; let index = 0;
  const navigate = target => {
    index = Math.max(0, Math.min(chunks.length - 1, target));
    if (chunks[index]) {
      const position = Math.min(view.state.doc.length, chunks[index].fromB);
      view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
      view.focus();
    }
    previous.disabled = !chunks.length || index === 0;
    next.disabled = !chunks.length || index >= chunks.length - 1;
    count.textContent = chunks.length ? `Change ${index + 1} of ${chunks.length}` : 'No text changes';
  };
  const extensions = [lineNumbers(), oneDark, language, EditorState.readOnly.of(true), EditorView.editable.of(false),
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' } }),
    keymap.of([{ key: 'Alt-ArrowDown', run: () => { navigate(index + 1); return true; } }, { key: 'Alt-ArrowUp', run: () => { navigate(index - 1); return true; } }])];
  function render() {
    merge?.destroy(); if (!merge) view?.destroy(); merge = null; host.replaceChildren();
    if (choice.value === 'split') {
      merge = new MergeView({ a: { doc: oldText, extensions }, b: { doc: newText, extensions }, parent: host, gutter: true, highlightChanges: true, collapseUnchanged: { margin: 3, minSize: 8 } });
      view = merge.b; chunks = merge.chunks;
    } else {
      view = new EditorView({ doc: newText, parent: host, extensions: [...extensions, unifiedMergeView({ original: oldText, gutter: true, highlightChanges: true, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 8 } })] });
      chunks = getChunks(view.state)?.chunks || [];
    }
    navigate(index);
  }
  previous.addEventListener('click', () => navigate(index - 1)); next.addEventListener('click', () => navigate(index + 1));
  choice.addEventListener('change', () => { render(); Promise.resolve(onModeChange(choice.value)).catch(error => { count.textContent = error.message; }); });
  render();
  return () => { if (merge) merge.destroy(); else view?.destroy(); root.remove(); };
}
