import { button, modal } from '../../renderer/components/dialog.js';
export function installOperations(root) {
  let current; let busy = false;
  const controls = document.createElement('details'); controls.className = 'git-operations git-dropdown';
  const summary = document.createElement('summary'); summary.textContent = 'Git operations'; controls.append(summary);
  const buttons = document.createElement('div'); buttons.className = 'git-dropdown-panel'; controls.append(buttons);
  const prompt = (title, fields) => new Promise(resolve => {
    const view = modal(title); const values = {};
    for (const [key, label, initial] of fields) {
      const row = document.createElement('label'); row.className = 'git-form-field'; row.textContent = label;
      const control = Array.isArray(initial) ? document.createElement('select') : key === 'message' ? document.createElement('textarea') : document.createElement('input');
      if (Array.isArray(initial)) for (const value of initial) control.append(new Option(value, value)); else control.value = initial || '';
      row.append(control); view.body.append(row); values[key] = control;
    }
    view.footer.append(button('Cancel', view.close), button(title, () => { resolve(Object.fromEntries(Object.entries(values).map(([key, input]) => [key, input.value]))); view.close(); }));
    view.dialog.addEventListener('close', () => resolve(null), { once: true });
  });
  root.addEventListener('git:snapshot', event => {
    current = event.detail; if (!controls.isConnected) current.toolbar.append(controls);
    buttons.replaceChildren();
    for (const [label, action, all] of [['Stage file', 'stage'], ['Unstage file', 'unstage'], ['Stage all', 'stage', true], ['Unstage all', 'unstage', true], ['Commit', 'commit'], ['Fetch', 'fetch'], ['Pull', 'pull'], ['Push', 'push'], ['Create branch', 'createBranch'], ['Switch branch', 'switchBranch']]) {
      const control = button(label, async () => {
        if (busy) return; controls.open = false; const context = current; let payload = { all, fileIds: [context.getSelected()] };
        try {
          if (action === 'commit') { const result = await prompt('Commit', [['message', 'Commit message (staged changes only)', '']]); if (!result) return; payload = result; }
          if (['fetch', 'pull', 'push'].includes(action)) {
            const remotes = await context.call('remotes', { contextId: context.repository.id });
            const fields = [['remote', 'Remote', remotes.remotes]];
            if (action !== 'fetch') fields.push(['branch', action === 'push' ? 'Destination branch' : 'Remote branch', context.snapshot.branch === 'Detached HEAD' ? '' : context.snapshot.branch]);
            const result = await prompt(label, fields); if (!result) return; payload = result;
          }
          if (action === 'createBranch' || action === 'switchBranch') {
            const result = await prompt(label, [['branch', 'Branch', action === 'switchBranch' ? context.snapshot.branches : '']]); if (!result) return; payload = result;
          }
          if (context !== current) throw new Error('Repository view changed. Try again.');
          busy = true; for (const item of buttons.querySelectorAll('button')) item.disabled = true;
          const result = await context.call('operation', { snapshotId: context.snapshot.id, action, payload });
          await context.reload(); context.status.textContent = result.output || `${label} completed`;
        } catch (error) { context.status.textContent = error.message; }
        finally { busy = false; for (const item of buttons.querySelectorAll('button')) item.disabled = Boolean(current.snapshot.base && ['stage', 'unstage', 'commit'].includes(item.dataset.action)); }
      });
      control.dataset.action = action; control.disabled = Boolean(current.snapshot.base && ['stage', 'unstage', 'commit'].includes(action)); buttons.append(control);
    }
  });
}
