const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const { DEFAULT_SETTINGS } = require('../main/constants');
const { normalizeProject } = require('../main/services/projects');
const { registerExternalEditors, trustedSender, EDITORS } = require('../main/services/externalEditors');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marina-editor-ui-')));
app.setPath('userData', root);
const fixture = path.join(root, 'fixture.mjs');
fs.writeFileSync(fixture, 'export default function activate(context){window.editorFixture={state:context.state,sessions:context.sessionTabs};}');
const folders = ['Backend', 'Frontend', 'Worker'].map(name => { const directory = path.join(root, name); fs.mkdirSync(directory); return { manualTitle: name, currentPath: directory, host: '__local__' }; });
let library = ['Active', 'Other'].map(name => normalizeProject({ id: `saved-${name}`, name, tabs: folders, externalEditor: { preferredEditorId: 'pycharm' } }));
let state = {
  tabs: ['Active', 'Other'].map(name => ({ id: `tab-${name}`, groupId: name, host: '__local__', currentPath: folders[0].currentPath, manualTitle: name })),
  activeTabId: 'tab-Active', tabGroups: ['Active', 'Other'].map(name => ({ id: name, name, savedGroupId: `saved-${name}`, layout: '1x1' }))
};
let settings = structuredClone(DEFAULT_SETTINGS); settings.ui.session.restoreTabs.value = true;
settings.editor.externalEditors.defaultEditorId.value = 'sublime';
let mainWindow, settingsWindow, missing = false, settingsRequests = 0, connections = 0;
const launches = [], errors = [];
const discovery = {
  list: async overrides => EDITORS.map(editor => ({ ...editor, override: overrides[editor.id] || '', path: overrides[editor.id] || process.execPath, version: 'test', status: overrides[editor.id] && overrides[editor.id] !== process.execPath ? 'invalid-path' : missing && editor.id === 'islet' ? 'not-installed' : 'available', installations: [{ path: process.execPath, executable: process.execPath, version: 'test' }] })),
  resolve: async (editor, location) => location === process.execPath && !(missing && editor.id === 'islet') ? { executable: location } : null
};
const routes = {
  'app:get-state': () => state, 'app:update-state': patch => (state = { ...state, ...patch }),
  'settings:get': () => settings, 'settings:update': value => (settings = value), 'settings:open': () => { settingsRequests++; },
  'ssh:hosts': () => [], 'ssh:connect': () => { connections++; return { ok: true }; }, 'ssh:disconnect': () => ({ ok: true }),
  'sftp:list': () => [], 'local:list': () => [], 'clipboard:read': () => '',
  'plugins:list': () => [{ id: 'fixture', name: 'Fixture', enabled: true, rendererEntry: pathToFileURL(fixture).href }],
  'groups:list': () => library,
  'groups:save': value => { const saved = normalizeProject({ ...value, id: value.id || 'created-project' }); library = [...library.filter(item => item.id !== saved.id), saved]; return saved; },
  'groups:delete': id => { library = library.filter(item => item.id !== id); },
  'plugin:mcp-server:status': () => ({ enabled: false })
};
for (const [channel, handler] of Object.entries(routes)) ipcMain.handle(channel, (_event, payload) => handler(payload));
ipcMain.on('ssh:write', () => {}); ipcMain.on('ssh:resize', () => {});
registerExternalEditors({
  ipcMain, getWindows: () => [mainWindow, settingsWindow], dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [process.execPath] }) },
  getState: () => state, getSettings: () => settings, library: { read: () => library }, root: path.join(root, 'workspaces'), discovery,
  openSettings: () => { settingsRequests++; },
  configure: patch => {
    settings.editor.externalEditors = patch;
    for (const window of [mainWindow, settingsWindow].filter(Boolean)) window.webContents.send('external-editors:settings-changed', patch);
  },
  launch: async (executable, args) => { launches.push({ executable, args }); }
});

app.whenReady().then(async () => {
  const create = () => new BrowserWindow({ show: false, width: 1000, height: 820, webPreferences: { preload: path.resolve('preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow = create();
  mainWindow.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await mainWindow.loadFile(path.resolve('index.html'));
  const evaluate = async (window, source) => {
    try { return await window.webContents.executeJavaScript(`(async()=>{${source}})()`, true); }
    catch (error) { console.error('UI step:', source); console.error(errors); throw error; }
  };
  const initHelpers = window => evaluate(window, `window.waitFor=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out: '+predicate);};window.clickText=text=>{const button=[...document.querySelectorAll('dialog[open] button')].reverse().find(el=>el.textContent===text);if(!button)throw new Error('Missing button '+text);button.click();};`);
  const run = source => evaluate(mainWindow, source);
  await initHelpers(mainWindow);
  await run(`await waitFor(()=>window.editorFixture && document.querySelector('[data-project-id="Other"]'));`);
  const initialConnections = connections;
  // The context action targets the non-active project and opens all saved roots.
  await run(`document.querySelector('[data-project-id="Other"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));clickText('Open in editor…');await waitFor(()=>document.querySelector('.external-editor-option'));`);
  assert.equal(await run(`return document.querySelector('.external-editor-option.preferred').dataset.editorId;`), 'pycharm');
  await run(`document.querySelector('[data-editor-id="antigravity"]').click();await waitFor(()=>!document.querySelector('.external-editor-picker'));`);
  assert.equal(launches.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(launches[0].args[1])).folders.map(folder => folder.name), ['Backend', 'Frontend', 'Worker']);
  assert(launches[0].args[1].endsWith('Other.code-workspace'));
  assert.equal(connections, initialConnections); assert.equal(state.tabs.length, 2);

  // Closed saved projects can launch directly; this must not restore terminals.
  await run(`document.querySelector('#open-project-btn').click();await waitFor(()=>document.querySelector('.workspace-library-row'));const row=[...document.querySelectorAll('.workspace-library-row')].find(row=>row.querySelector('strong').textContent==='Active');[...row.querySelectorAll('button')].find(button=>button.textContent==='Open in editor…').click();await waitFor(()=>document.querySelector('.external-editor-option'));document.querySelector('[data-editor-id="sublime"]').click();await waitFor(()=>!document.querySelector('.external-editor-picker'));`);
  assert.equal(launches.length, 2); assert.equal(launches[1].args[1], '--project'); assert.equal(state.tabs.length, 2);

  // Missing directories are listed together and link to the correct saved setup.
  const other = library.find(project => project.id === 'saved-Other');
  const originalRoot = other.tabs[0].initialPath; other.tabs[0].initialPath = path.join(root, 'missing-folder');
  await run(`document.querySelector('#open-project-btn').click();await waitFor(()=>document.querySelector('.workspace-library-row'));const row=[...document.querySelectorAll('.workspace-library-row')].find(row=>row.querySelector('strong').textContent==='Other');[...row.querySelectorAll('button')].find(button=>button.textContent==='Open in editor…').click();await waitFor(()=>document.querySelector('.external-editor-option'));document.querySelector('[data-editor-id="antigravity"]').click();await waitFor(()=>document.querySelector('.external-editor-error ul'));clickText('Edit project');await waitFor(()=>document.querySelector('#project-name'));`);
  assert.equal(await run(`return document.querySelector('#project-name').value;`), 'Other');
  await run(`clickText('Cancel');`); other.tabs[0].initialPath = originalRoot;

  // A missing editor opens a named modal and its Settings action works.
  missing = true;
  await run(`document.querySelector('#project-options-btn').click();clickText('Open in editor…');await waitFor(()=>document.querySelector('.external-editor-option'));document.querySelector('[data-editor-id="islet"]').click();await waitFor(()=>[...document.querySelectorAll('dialog h2')].some(el=>el.textContent==='Islet not found'));clickText('Open editor settings');await waitFor(()=>!document.querySelector('.external-editor-picker'));`);
  assert.equal(settingsRequests, 1); assert.equal(launches.length, 2);
  missing = false;

  // Group context menu uses the same action, including after terminal navigation.
  await run(`const tab=editorFixture.state.tabs.get('tab-Active');tab.currentPath=${JSON.stringify(root)};document.querySelector('.session-tab[data-tab-id="tab-Active"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100}));[...document.querySelectorAll('.context-menu.open button')].find(button=>button.textContent==='Open project in editor…').click();await waitFor(()=>document.querySelector('.external-editor-option'));document.querySelector('[data-editor-id="pycharm"]').click();await waitFor(()=>!document.querySelector('.external-editor-picker'));`);
  assert.equal(launches.length, 3);
  const pyManifest = JSON.parse(fs.readFileSync(path.join(launches[2].args[0], 'marinashell.json')));
  assert.deepEqual(pyManifest.folders.map(folder => folder.path), folders.map(folder => folder.currentPath));

  // Islet preserves mixed local/SSH roots in a named workspace without opening terminals.
  const mixed = normalizeProject({ id: 'saved-mixed', name: 'Mixed workspace', tabs: [...folders, { host: 'fixture-host', currentPath: '/srv/worker', manualTitle: 'Remote worker' }] });
  library.push(mixed);
  await run(`await editorFixture.state.externalEditors.openSaved(${JSON.stringify(mixed)});await waitFor(()=>document.querySelector('.external-editor-option'));document.querySelector('[data-editor-id="islet"]').click();await waitFor(()=>!document.querySelector('.external-editor-picker'));`);
  assert.equal(launches.length, 4);
  assert.deepEqual(launches[3].args.slice(0, 3), ['open', '--new-window', '--workspace']);
  const isletWorkspace = JSON.parse(fs.readFileSync(launches[3].args[3]));
  assert.equal(isletWorkspace.name, 'Mixed workspace');
  assert.deepEqual(isletWorkspace.roots.map(item => item.hostId), ['local', 'local', 'local', 'ssh:fixture-host']);
  assert.equal(connections, initialConnections);

  // Project preferences survive edits and snapshot saves.
  await run(`document.querySelector('#project-options-btn').click();clickText('Edit saved setup');await waitFor(()=>document.querySelector('#project-external-editor')?.options.length>2);document.querySelector('#project-external-editor').value='islet';clickText('Save project');await waitFor(()=>!document.querySelector('.project-editor'));`);
  assert.equal(library.find(project => project.id === 'saved-Active').externalEditor.preferredEditorId, 'islet');
  await run(`document.querySelector('#project-options-btn').click();clickText('Save current sessions and layout');await waitFor(()=>!document.querySelector('.project-options'));await editorFixture.state.externalEditors.openGroup('Active');await waitFor(()=>document.querySelector('.external-editor-option'));`);
  assert.equal(library.find(project => project.id === 'saved-Active').externalEditor.preferredEditorId, 'islet');
  assert.equal(await run(`return document.querySelector('.external-editor-option.preferred').dataset.editorId;`), 'islet');
  const screenshotDir = path.resolve('design/validation'); fs.mkdirSync(screenshotDir, { recursive: true });
  mainWindow.showInactive(); await new Promise(resolve => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(screenshotDir, 'external-editor-picker.png'), (await mainWindow.webContents.capturePage()).toPNG());
  await run(`clickText('Cancel');`);

  settingsWindow = create();
  await settingsWindow.loadFile(path.resolve('settings.html'), { hash: 'preferences-editor' });
  await initHelpers(settingsWindow);
  const inSettings = source => evaluate(settingsWindow, source);
  await inSettings(`await waitFor(()=>document.querySelectorAll('.external-editor-setting').length===${EDITORS.length});`);
  await inSettings(`const input=document.querySelector('[data-editor-id="islet"] input');input.value='/missing/editor';input.dispatchEvent(new Event('change'));await waitFor(()=>document.querySelector('[data-editor-id="islet"] .hint').textContent.includes('unavailable'));`);
  assert.equal(settings.editor.externalEditors.overrides.value.islet, '/missing/editor');
  await inSettings(`const row=document.querySelector('[data-editor-id="islet"]');[...row.querySelectorAll('button')].find(button=>button.textContent==='Browse…').click();await waitFor(()=>document.querySelector('[data-editor-id="islet"] input').value===${JSON.stringify(process.execPath)});`);
  assert.equal(settings.editor.externalEditors.overrides.value.islet, process.execPath);
  await inSettings(`const row=document.querySelector('[data-editor-id="islet"]');[...row.querySelectorAll('button')].find(button=>button.textContent==='Use detected path').click();await waitFor(()=>document.querySelector('[data-editor-id="islet"] .hint').textContent.startsWith('Auto-detected'));document.querySelector('#external-editor-default').value='islet';document.querySelector('#external-editor-default').dispatchEvent(new Event('change'));await waitFor(()=>document.querySelector('#external-editor-status').textContent==='Editor settings saved.');`);
  assert.equal(settings.editor.externalEditors.overrides.value.islet, undefined);
  assert.equal(settings.editor.externalEditors.defaultEditorId.value, 'islet');
  // Existing file-editor settings save must retain the independently updated paths/default.
  await inSettings(`const input=document.querySelector('#editor-local-command');input.value='custom-editor {path}';input.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,450));`);
  assert.equal(settings.editor.externalEditors.defaultEditorId.value, 'islet');
  await settingsWindow.reload(); await initHelpers(settingsWindow);
  await inSettings(`await waitFor(()=>document.querySelectorAll('.external-editor-setting').length===${EDITORS.length});`);
  assert.equal(await inSettings(`return document.querySelector('#external-editor-default').value;`), 'islet');
  settingsWindow.showInactive();
  for (const width of [1000, 560]) {
    settingsWindow.setSize(width, 820); await new Promise(resolve => setTimeout(resolve, 150));
    await inSettings(`document.querySelector('#external-editors-settings').scrollIntoView({block:'start'});`);
    assert.equal(await inSettings(`return document.documentElement.scrollWidth<=innerWidth && document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth;`), true);
    fs.writeFileSync(path.join(screenshotDir, `external-editor-settings-${width}.png`), (await settingsWindow.webContents.capturePage()).toPNG());
  }
  // Reject another BrowserWindow and subframes.
  const untrusted = create(); await untrusted.loadURL('about:blank');
  assert.equal(trustedSender({ sender: untrusted.webContents, senderFrame: untrusted.webContents.mainFrame }, [mainWindow, settingsWindow]), false);
  assert.equal(trustedSender({ sender: mainWindow.webContents, senderFrame: {} }, [mainWindow, settingsWindow]), false);
  untrusted.destroy();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: real Electron project/group actions, non-active targeting, saved-project launch, missing-editor modal, defaults, snapshot preservation, custom paths, browsing, reset, settings reload and responsive layout');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => { fs.rmSync(root, { recursive: true, force: true }); });
