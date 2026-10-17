import { activateDebugger } from '../pydebug/renderer.js';
import { modal, button } from '../../renderer/components/dialog.js';
function setup({ call, state, refresh }) {
  const view = modal('JavaScript debugger setup and attach');
  const status = document.createElement('p'); status.setAttribute('role', 'status'); view.body.append(status);
  const fields = {};
  for (const [name, label, value] of [['adapterPath', 'Custom adapter entry point (optional)', ''], ['nodePath', 'Adapter Node runtime (optional)', ''], ['host', 'Inspector host (SSH alias or __local__)', state.tabs.get(state.activeTabId)?.host || '__local__'], ['port', 'Loopback inspector port', '9229'], ['cwd', 'Source working directory', state.tabs.get(state.activeTabId)?.currentPath || '']]) {
    const row = document.createElement('label'); row.className = 'pd-field'; row.textContent = label; const input = document.createElement('input'); input.value = value; input.setAttribute('aria-label', label); row.append(input); view.body.append(row); fields[name] = input;
  }
  const showStatus = value => { status.textContent = `${value.installed ? 'Installed' : 'Not installed'} · Microsoft js-debug ${value.version}\n${value.path}`; };
  const safe = fn => async event => { const control = event.currentTarget; control.disabled = true; try { await fn(); } catch (error) { status.textContent = error.message; } finally { control.disabled = false; } };
  view.body.append(button('Install verified adapter', safe(async () => { status.textContent = 'Downloading and verifying Microsoft js-debug…'; showStatus((await call('adapter-install')).status); })),
    button('Save adapter paths', safe(async () => showStatus((await call('adapter-settings', { adapterPath: fields.adapterPath.value, nodePath: fields.nodePath.value })).status))));
  const browser = document.createElement('select'); browser.setAttribute('aria-label', 'Browser debugger'); browser.append(new Option('Chrome', 'chrome'), new Option('Edge', 'edge'));
  const url = document.createElement('input'); url.placeholder = 'http://localhost:5173'; url.setAttribute('aria-label', 'Application URL');
  const browserPath = document.createElement('input'); browserPath.placeholder = 'Browser executable (optional)'; browserPath.setAttribute('aria-label', 'Browser executable');
  view.body.append(browser, url, browserPath);
  const browserAction = mode => safe(async () => {
    const tab = state.tabs.get(state.activeTabId);
    await call('browser', { browser: browser.value, mode, url: url.value, webRoot: fields.cwd.value, runtimeExecutable: browserPath.value, host: fields.host.value, port: Number(fields.port.value), projectId: tab?.groupId || '' }); await refresh(); view.close();
  });
  view.body.append(button('Launch browser debugger', browserAction('launch')), button('Attach to browser', browserAction('attach')));
  view.footer.append(button('Close', view.close), button('Attach to Node', safe(async () => {
    const tab = state.tabs.get(state.activeTabId); await call('attach', { host: fields.host.value, port: Number(fields.port.value), cwd: fields.cwd.value, projectId: tab?.groupId || '' }); await refresh(); view.close();
  })));
  call('adapter-status').then(result => { showStatus(result.status); fields.adapterPath.value = result.status.customAdapterPath || ''; fields.nodePath.value = result.status.customNodePath || ''; }).catch(error => { status.textContent = error.message; });
}
export default context => activateDebugger(context, { id: 'jsdebug', label: 'JSDebug', type: 'javascript', extensions: /\.(?:[cm]?[jt]s|[jt]sx)$/i, setup });
