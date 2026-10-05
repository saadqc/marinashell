import { button } from '../../renderer/components/dialog.js';

// Status belongs to this draft's environment, never to a saved configuration id.
export function debugpySetup({ parent, form, getDraft, call, api }) {
  const box = document.createElement('section'); box.className = 'run-debugpy-setup';
  const title = document.createElement('h3'); title.className = 'run-section-title'; title.textContent = 'Python debugger';
  const status = document.createElement('p'); status.className = 'run-debugpy-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const context = document.createElement('small'); context.className = 'run-hint';
  const command = document.createElement('code'); command.className = 'run-debugpy-command';
  const actions = document.createElement('div'); actions.className = 'run-debugpy-actions';
  const details = document.createElement('details'); details.className = 'run-debugpy-details';
  const summary = document.createElement('summary'); summary.textContent = 'Installation output';
  const output = document.createElement('pre'); details.append(summary, output); details.hidden = true;
  let timer, generation = 0, disposed = false, busy = false, detected = null;
  const key = () => {
    const c = getDraft();
    return JSON.stringify(['type', 'host', 'cwd', 'interpreter', 'manager', 'managerPath', 'environment', 'env', 'envFiles', 'inheritEnv', 'setupScripts'].map(k => c[k]));
  };
  let current = key();
  const visible = () => !parent.hidden;
  function controls() {
    check.disabled = busy; install.disabled = busy || !detected?.pythonSupported || detected.compatible;
    install.hidden = Boolean(detected?.compatible); copy.disabled = busy || !command.textContent;
    install.textContent = detected?.found ? 'Install compatible debugpy' : 'Install debugpy';
  }
  function reset() {
    detected = null; busy = false; command.textContent = ''; output.textContent = ''; details.hidden = true;
    status.dataset.state = '';
    status.textContent = getDraft().setupScripts?.length
      ? 'Click Check debugpy to apply setup scripts and inspect this environment.' : 'Check debugpy in the current environment.';
    context.textContent = `Uses this configuration’s interpreter and environment on ${getDraft().host === '__local__' ? 'the local machine' : `SSH · ${getDraft().host}`}.`;
    controls();
  }
  function display(result) {
    detected = result; command.textContent = result.installCommand;
    context.textContent = `${result.host === '__local__' ? 'Local' : `SSH · ${result.host}`} · Python ${result.pythonVersion} · ${result.interpreter}`;
    status.dataset.state = result.compatible ? 'ready' : 'missing';
    status.textContent = result.compatible ? `debugpy found in current environment (${result.version}).`
      : !result.pythonSupported ? 'PyDebug requires Python 3.9 or newer. Select a newer interpreter.'
      : result.error ? `debugpy could not be loaded: ${result.error}`
      : result.found ? `debugpy ${result.version} found; PyDebug requires debugpy 1.8.x.`
      : 'debugpy is not installed in the current environment. Install it to enable debugging.';
  }
  async function perform(installing = false) {
    clearTimeout(timer);
    if (busy || disposed) return;
    const version = ++generation; const snapshot = JSON.parse(JSON.stringify(getDraft())); const fingerprint = key();
    busy = true; controls();
    status.dataset.state = ''; status.textContent = installing ? 'Installing debugpy in this environment…' : 'Checking debugpy in this environment…';
    try {
      const result = await call(installing ? 'debugpy-install' : 'debugpy-check', { configuration: snapshot });
      if (disposed || version !== generation || fingerprint !== key()) return;
      display(result.status);
      if (installing) { output.textContent = result.output; details.hidden = !result.output; }
    } catch (error) {
      if (disposed || version !== generation || fingerprint !== key()) return;
      status.dataset.state = 'error';
      if (installing) {
        status.textContent = 'Installation failed. See installation output and retry.';
        output.textContent = error.message; details.hidden = false; details.open = true;
      } else status.textContent = `Check failed: ${error.message}`;
    } finally {
      if (!disposed && version === generation && fingerprint === key()) { busy = false; controls(); }
    }
  }
  const check = button('Check debugpy', () => perform()); check.className = 'run-debugpy-check';
  const install = button('Install debugpy', () => perform(true)); install.className = 'run-debugpy-install';
  const copy = button('Copy command', async () => {
    try { await api.copyToClipboard(command.textContent); } catch (error) { status.textContent = error.message; }
  });
  actions.append(check, install, copy); box.append(title, status, context, command, actions, details); parent.append(box);
  function refresh() {
    if (disposed) return;
    const next = key();
    if (next !== current) { current = next; generation++; clearTimeout(timer); reset(); }
    // Scripts can do more than export variables. Run them only through an
    // explicit Check/Install click, never merely by opening/editing the dialog.
    if (visible() && !busy && !detected && !getDraft().setupScripts?.length) {
      clearTimeout(timer); timer = setTimeout(() => perform(), 500);
    }
  }
  form.addEventListener('input', refresh); form.addEventListener('change', refresh);
  reset();
  return { refresh, dispose() { disposed = true; generation++; clearTimeout(timer); form.removeEventListener('input', refresh); form.removeEventListener('change', refresh); } };
}
