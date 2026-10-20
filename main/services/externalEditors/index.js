const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const { EDITORS, editorById, readPreferences } = require('./registry');
const { createDiscovery } = require('./discovery');
const { prepareWorkspace, resolveFolders, failure } = require('./workspaces');

function launchProcess(executable, args, { platform = process.platform, isletAppPath } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'VSCODE_IPC_HOOK_CLI', 'NODE_OPTIONS', 'NODE_REPL_EXTERNAL_MODULE']) delete env[key];
    if (isletAppPath) env.ISLET_APP_PATH = isletAppPath;
    const child = spawn(executable, args, { shell: false, detached: platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env });
    let stderr = '', settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stderr?.removeAllListeners('data'); child.stderr?.resume(); child.stderr?.unref?.(); child.unref();
      if (error) reject(failure('LAUNCH_FAILED', error.message)); else resolve();
    };
    child.stderr?.on('data', data => { stderr = (stderr + data).slice(-3000); });
    child.once('error', error => finish(error));
    child.once('exit', (code, signal) => finish(code || signal ? new Error(stderr.trim() || `The editor launcher exited ${signal ? `with signal ${signal}` : `with code ${code}`}.`) : null));
    const timer = setTimeout(() => finish(), 1800);
  });
}

function createExternalEditors({ getSettings, getState, library, root = path.join(os.homedir(), '.marinashell/editor-workspaces'), discovery = createDiscovery(), launch = launchProcess, interpreterHandoff } = {}) {
  const pending = new Map();
  function projectFor(request) {
    if (!request || typeof request !== 'object') throw failure('INVALID_PROJECT', 'Choose a project or group to open.');
    let project;
    if (typeof request.savedProjectId === 'string') project = library.read().find(item => item.id === request.savedProjectId);
    else if (typeof request.projectId === 'string') {
      const state = getState();
      const group = state.tabGroups?.find(item => item.id === request.projectId);
      if (group?.savedGroupId) project = library.read().find(item => item.id === group.savedGroupId);
      if (!project && group) project = { ...group, tabs: (state.tabs || []).filter(tab => tab.groupId === group.id) };
    }
    if (!project || typeof project.id !== 'string' || !Array.isArray(project.tabs) || project.tabs.length > 32) throw failure('INVALID_PROJECT', 'This project is unavailable. Reopen the project list and try again.');
    return project;
  }
  async function list(refresh = false) {
    const prefs = readPreferences(getSettings());
    return { editors: await discovery.list(prefs.overrides, refresh), defaultEditorId: prefs.defaultEditorId };
  }
  async function open(request) {
    const project = projectFor(request);
    const prefs = readPreferences(getSettings());
    const id = request.editorId || project.externalEditor?.preferredEditorId || prefs.defaultEditorId;
    const editor = editorById(id);
    if (!editor) throw failure('CHOOSE_EDITOR', 'Choose an editor for this project.');
    const key = `${project.id}:${id}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const item = (await list()).editors.find(item => item.id === id);
      const installation = item.path && await discovery.resolve(editor, item.path);
      if (!installation) throw failure(item.override ? 'INVALID_EDITOR_PATH' : 'EDITOR_MISSING', item.override ? `The configured path for ${editor.name} is unavailable or is not a supported launcher. Choose its application or executable in Settings.` : `${editor.name} is not installed, or its installation could not be found.`, { editorId: id });
      const folders = await resolveFolders(project, { allowRemote: editor.family === 'islet' });
      const groups = (getState().tabGroups || []).filter(group => group.id === project.id || group.savedGroupId === project.id);
      const interpreterProject = { ...project, configurationIds: [...new Set([...(project.configurationIds || []), ...groups.flatMap(group => group.configurationIds || [])])] };
      const resolveInterpreter = editor.family === 'islet' && interpreterHandoff && request.useExistingWorkspace !== true
        ? await interpreterHandoff(interpreterProject, folders, [project.id, ...groups.map(group => group.id)]) : undefined;
      const workspace = folders.length === 1 && editor.family !== 'islet'
        ? { target: folders[0].path }
        : await prepareWorkspace({ root, editor, project, folders, resolveInterpreter, useExisting: request.useExistingWorkspace === true });
      const args = editor.family === 'islet' ? ['open', '--new-window', '--workspace', workspace.target]
        : editor.family === 'code' ? ['--new-window', workspace.target]
        : editor.family === 'sublime' ? ['--new-window', ...(folders.length > 1 ? ['--project'] : []), workspace.target]
          : [workspace.target];
      await launch(installation.executable, [...(installation.prefixArgs || []), ...args], { isletAppPath: installation.isletAppPath });
      return { editorId: id, editorName: editor.name, folderCount: workspace.existing ? null : folders.length, workspacePath: workspace.target, usedExisting: Boolean(workspace.existing) };
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return { list, open };
}

function trustedSender(event, windows) {
  if (!windows.some(window => window && !window.isDestroyed() && window.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:' && ['index.html', 'settings.html'].some(file => fileURLToPath(url) === path.resolve(__dirname, '../../..', file));
  } catch { return false; }
}

function registerExternalEditors({ ipcMain, getWindows, dialog, getSettings, getState, library, openSettings, configure, ...options }) {
  const service = createExternalEditors({ getSettings, getState, library, ...options });
  const handlers = {
    list: payload => service.list(payload?.refresh === true),
    open: payload => service.open(payload),
    settings: () => openSettings(),
    configure: async payload => {
      if (!payload || typeof payload.defaultEditorId !== 'string' || !payload.overrides) throw new Error('Invalid editor settings.');
      const patch = { defaultEditorId: { type: 'string', value: payload.defaultEditorId }, overrides: { type: 'object', value: payload.overrides } };
      require('./registry').validateSettings({ editor: { externalEditors: patch } });
      await configure(patch);
      return service.list();
    },
    browse: async payload => {
      const editor = editorById(payload?.editorId);
      if (!editor) throw new Error('Choose a supported editor.');
      const parent = getWindows().find(window => window && !window.isDestroyed() && window.isFocused()) || getWindows().find(Boolean);
      const result = await dialog.showOpenDialog(parent, { title: `Choose ${editor.name}`, properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Applications', extensions: ['exe'] }] } : {}) });
      return { path: result.canceled ? null : result.filePaths[0] };
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`external-editors:${name}`, async (event, payload) => {
    if (!trustedSender(event, getWindows())) throw new Error('External editors are available only in MarinaShell windows.');
    try { return { ok: true, ...await handler(payload) }; }
    catch (error) { return { ok: false, code: error.code || 'EDITOR_ERROR', error: error.message, folders: error.folders, canUseExisting: error.canUseExisting }; }
  });
  return service;
}
module.exports = { createExternalEditors, registerExternalEditors, launchProcess, trustedSender, EDITORS };
