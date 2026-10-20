const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { EDITORS, validateSettings } = require('../main/services/externalEditors/registry');
const { resolveInstallation, createDiscovery } = require('../main/services/externalEditors/discovery');
const { prepareWorkspace, resolveFolders } = require('../main/services/externalEditors/workspaces');
const { createExternalEditors, launchProcess } = require('../main/services/externalEditors');
const { normalizeProject } = require('../main/services/projects');
const { DEFAULT_SETTINGS } = require('../main/constants');

(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marina-editors-')));
  const workspaceRoot = path.join(root, 'workspaces');
  const folders = ['Backend & API', 'Frontend', "Worker 'quoted' 日本語"].map(name => {
    const directory = path.join(root, name); fs.mkdirSync(directory); return { name, path: directory };
  });
  fs.mkdirSync(path.join(folders[0].path, '.git'));
  fs.mkdirSync(path.join(folders[2].path, '.git'));
  const project = normalizeProject({ id: '../../outside', name: 'Same project', externalEditor: { preferredEditorId: 'pycharm' }, tabs: folders.map(folder => ({ host: '__local__', manualTitle: folder.name, currentPath: folder.path })) });
  const byId = id => EDITORS.find(editor => editor.id === id);
  const options = id => ({ root: workspaceRoot, editor: byId(id), project, folders });
  try {
    const symlink = path.join(root, 'backend-link'); fs.symlinkSync(folders[0].path, symlink, 'dir');
    assert.deepEqual(await resolveFolders({ ...project, tabs: [...project.tabs, { host: '__local__', currentPath: symlink }] }), folders);
    const navigated = { ...project, tabs: project.tabs.map(tab => ({ ...tab, currentPath: root, treeRootPath: root })) };
    assert.deepEqual(await resolveFolders(navigated), folders, 'Initial configured folders survive terminal and file-tree navigation');
    await assert.rejects(resolveFolders({ ...project, tabs: [...project.tabs, { host: 'ssh-host', currentPath: '/srv/backend' }] }), error => error.code === 'REMOTE_UNSUPPORTED' && error.folders.length === 1);
    await assert.rejects(resolveFolders({ ...project, tabs: [{ host: '__local__', currentPath: '/missing-project-root' }] }), error => error.code === 'MISSING_FOLDERS');
    assert.throws(() => normalizeProject({ ...project, externalEditor: { preferredEditorId: 'unknown' } }));
    assert.throws(() => validateSettings({ editor: { externalEditors: { overrides: { value: { vscode: 'bad\npath' } } } } }));

    for (const id of ['vscode', 'antigravity', 'sublime']) {
      const prepared = await prepareWorkspace(options(id));
      assert(prepared.target.startsWith(workspaceRoot));
      assert.deepEqual(JSON.parse(fs.readFileSync(prepared.target)).folders, folders);
      const content = fs.readFileSync(prepared.target, 'utf8').replace('{', '{\n  // User comment\n  "settings": {"editor.tabSize": 8},');
      fs.writeFileSync(prepared.target, content);
      await prepareWorkspace(options(id));
      assert.equal(fs.readFileSync(prepared.target, 'utf8'), content, 'An unchanged launch leaves user edits byte-for-byte intact');
      const reduced = await prepareWorkspace({ ...options(id), folders: folders.slice(0, 2) });
      const updated = fs.readFileSync(reduced.target, 'utf8');
      assert(updated.includes('// User comment')); assert(updated.includes('"editor.tabSize": 8'));
      assert(!updated.includes(folders[2].name));
      const renamed = await prepareWorkspace({ ...options(id), project: { ...project, name: 'Renamed' }, folders: folders.slice(0, 2) });
      assert.equal(renamed.target, prepared.target);
      const edited = updated.replace(folders[0].name, 'Changed in IDE'); fs.writeFileSync(prepared.target, edited);
      await assert.rejects(prepareWorkspace(options(id)), error => error.code === 'WORKSPACE_CONFLICT' && error.canUseExisting);
      assert.equal(fs.readFileSync(prepared.target, 'utf8'), edited);
      assert.equal((await prepareWorkspace({ ...options(id), useExisting: true })).target, prepared.target);
    }
    // A grouped PyCharm project owns only its aggregate metadata, with SDKs per module.
    const sourceIdea = path.join(folders[0].path, '.idea'); fs.mkdirSync(sourceIdea);
    const original = '<project><component name="ProjectRootManager" project-jdk-name="Backend Python &amp; tools" project-jdk-type="Python SDK" /></project>';
    fs.writeFileSync(path.join(sourceIdea, 'misc.xml'), original);
    const py = await prepareWorkspace(options('pycharm'));
    const idea = path.join(py.directory, '.idea');
    const manifest = JSON.parse(fs.readFileSync(path.join(py.directory, 'marinashell.json')));
    const moduleFile = path.join(idea, manifest.modules[0].file);
    assert.equal(manifest.modules[0].file, 'Backend & API.iml');
    const moduleText = fs.readFileSync(moduleFile, 'utf8');
    assert(moduleText.includes('Backend Python &amp; tools'));
    assert(moduleText.includes(pathToFileURL(folders[0].path).href.replaceAll('&', '&amp;')));
    assert(fs.readFileSync(path.join(idea, 'modules.xml'), 'utf8').includes('Backend &amp; API.iml'));
    fs.writeFileSync(moduleFile, moduleText.replace('Backend Python &amp; tools', 'Changed in IDE'));
    fs.writeFileSync(path.join(idea, 'workspace.xml'), '<user-session />');
    const vcsFile = path.join(idea, 'vcs.xml');
    let vcs = fs.readFileSync(vcsFile, 'utf8');
    assert.equal((vcs.match(/<mapping /g) || []).length, 2, 'Only actual repositories get Git mappings');
    vcs = vcs.replace('</component>', '<mapping directory="/user/other-repo" vcs="Git" /></component>'); fs.writeFileSync(vcsFile, vcs);
    await prepareWorkspace({ ...options('pycharm'), folders: folders.slice(0, 2) });
    assert(fs.readFileSync(moduleFile, 'utf8').includes('Changed in IDE'));
    assert.equal(fs.readFileSync(path.join(idea, 'workspace.xml'), 'utf8'), '<user-session />');
    assert.equal(fs.readFileSync(path.join(sourceIdea, 'misc.xml'), 'utf8'), original);
    assert(fs.readFileSync(vcsFile, 'utf8').includes('/user/other-repo'), 'Keep user repository mappings during membership changes');
    await prepareWorkspace(options('pycharm'));
    assert(fs.readFileSync(vcsFile, 'utf8').includes(folders[2].path.replaceAll("'", '&apos;')), 'A removed folder can be re-added with its existing module and SDK choices');
    fs.writeFileSync(moduleFile, moduleText.replace('url="file:', 'url="changed:'));
    await assert.rejects(prepareWorkspace({ ...options('pycharm'), folders: folders.slice(0, 2) }), error => error.code === 'WORKSPACE_CONFLICT');

    // A macOS app is resolved without a shell alias; reject the separate Antigravity hub.
    const app = path.join(root, 'home/Applications/Antigravity IDE.app');
    const bin = path.join(app, 'Contents/Resources/app/bin/antigravity-ide'); fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    fs.writeFileSync(path.join(app, 'Contents/Resources/app/product.json'), JSON.stringify({ applicationName: 'antigravity-ide', version: 'fixture' }));
    assert.equal((await resolveInstallation(byId('antigravity'), app, { platform: 'darwin' })).executable, bin);
    assert.equal(await resolveInstallation(byId('vscode'), app, { platform: 'darwin' }), null);
    assert.equal(await resolveInstallation(byId('vscode'), path.join(root, 'code.cmd'), { platform: 'win32' }), null);
    const discovered = await createDiscovery({ home: path.join(root, 'home'), env: { PATH: '' }, platform: 'darwin' }).list({ antigravity: app });
    assert.equal(discovered.find(editor => editor.id === 'antigravity').path, app);
    assert.equal(discovered.find(editor => editor.id === 'antigravity').status, 'available');

    const settings = structuredClone(DEFAULT_SETTINGS), calls = [];
    let available = true;
    const fakeDiscovery = {
      list: async overrides => EDITORS.map(editor => ({ ...editor, override: overrides[editor.id] || '', path: overrides[editor.id] || process.execPath, status: available ? 'available' : 'not-installed' })),
      resolve: async (_editor, location) => available && location === process.execPath ? { executable: location } : null
    };
    let state = { tabGroups: [{ id: 'live', name: 'Live', savedGroupId: project.id }], tabs: [] };
    const service = createExternalEditors({ getSettings: () => settings, getState: () => state, library: { read: () => [project] }, root: path.join(root, 'service-workspaces'), discovery: fakeDiscovery, launch: async (...args) => { calls.push(args); await new Promise(resolve => setTimeout(resolve, 10)); } });
    const result = await Promise.all([service.open({ projectId: 'live', editorId: 'antigravity' }), service.open({ savedProjectId: project.id, editorId: 'antigravity' })]);
    assert.equal(calls.length, 1, 'Concurrent launches for one project and editor are coalesced');
    assert.equal(result[0].folderCount, 3); assert.equal(calls[0][1][0], '--new-window');
    assert.deepEqual(JSON.parse(fs.readFileSync(calls[0][1][1])).folders, folders, 'Saved roots launch without terminal sessions');
    await service.open({ savedProjectId: project.id }); assert.equal(calls.length, 2, 'A project preference overrides the global choice');
    settings.editor.externalEditors.overrides.value = { vscode: '/removed/editor' };
    await assert.rejects(service.open({ savedProjectId: project.id, editorId: 'vscode' }), error => error.code === 'INVALID_EDITOR_PATH');
    available = false;
    await assert.rejects(service.open({ savedProjectId: project.id, editorId: 'sublime' }), error => error.code === 'EDITOR_MISSING');
    available = true;
    state = { tabGroups: [{ id: 'unsaved', name: 'New group' }], tabs: project.tabs.map(tab => ({ ...tab, groupId: 'unsaved' })) };
    await service.open({ projectId: 'unsaved', editorId: 'sublime' });
    assert.equal(calls.at(-1)[1][1], '--project');
    const sentinel = path.join(root, 'must-not-exist');
    const echoed = path.join(root, 'literal-argument.txt');
    await launchProcess(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[2],process.argv[1])', `$(touch ${sentinel})`, echoed]);
    assert.equal(fs.readFileSync(echoed, 'utf8'), `$(touch ${sentinel})`);
    assert.equal(fs.existsSync(sentinel), false, 'Project paths cannot invoke shell substitution');
    await assert.rejects(launchProcess(process.execPath, ['-e', 'console.error("Fixture launch failure");process.exit(7)']), error => error.code === 'LAUNCH_FAILED' && /Fixture launch failure/.test(error.message));
    console.log('PASS: editor discovery, overrides, stable roots, JSONC preservation, conflict protection, SDK preservation, saved and live groups, launch coalescing, shell safety and launch errors');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
