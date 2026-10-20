const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { EDITORS, validateSettings } = require('../main/services/externalEditors/registry');
const { createDiscovery, resolveInstallation } = require('../main/services/externalEditors/discovery');
const { resolveFolders, prepareWorkspace } = require('../main/services/externalEditors/workspaces');
const { createExternalEditors, launchProcess } = require('../main/services/externalEditors');
const { normalizeProject } = require('../main/services/projects');
const { DEFAULT_SETTINGS } = require('../main/constants');

(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marina-islet-')));
  const editor = EDITORS.find(item => item.id === 'islet');
  const app = path.join(root, 'Custom Editors', 'Islet.app');
  const runtime = path.join(app, 'Contents/Resources/resources/runtime/node');
  const cli = path.join(app, 'Contents/Resources/_up_/scripts/islet.mjs');
  const native = path.join(app, 'Contents/MacOS/islet');
  const recording = path.join(root, 'launch.json');
  try {
    for (const file of [runtime, cli, native]) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync(process.execPath, runtime);
    fs.writeFileSync(native, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>dev.islet.editor</string><key>CFBundleShortVersionString</key><string>0.1.0</string></dict></plist>');
    fs.writeFileSync(cli, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(recording)}, JSON.stringify({args:process.argv.slice(2),app:process.env.ISLET_APP_PATH}));`);
    const installation = await resolveInstallation(editor, app, { platform: 'darwin' });
    assert.equal(installation.executable, runtime);
    assert.deepEqual(installation.prefixArgs, [cli]);
    assert.equal(installation.isletAppPath, app);
    assert.equal(installation.version, '0.1.0');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, 'Applications'), { recursive: true });
    fs.symlinkSync(app, path.join(home, 'Applications/Islet.app'), 'dir');
    const discovery = createDiscovery({ home, env: { PATH: '' }, platform: 'darwin' });
    assert.equal((await discovery.list()).find(item => item.id === 'islet').status, 'available');
    assert.equal((await discovery.list({ islet: app })).find(item => item.id === 'islet').path, app);
    assert.equal((await discovery.list({ islet: path.join(root, 'missing') })).find(item => item.id === 'islet').status, 'invalid-path');
    const launcher = path.join(root, 'islet-cli');
    fs.writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    assert.equal((await resolveInstallation(editor, launcher)).executable, launcher);
    assert.equal(await resolveInstallation(editor, app, { platform: 'win32' }), null);
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist><key>CFBundleIdentifier</key><string>example.other</string></plist>');
    assert.equal(await resolveInstallation(editor, app, { platform: 'darwin' }), null);
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist><key>CFBundleIdentifier</key><string>dev.islet.editor</string></plist>');

    const backend = path.join(root, "Backend & 'quoted' 日本語");
    fs.mkdirSync(backend);
    const backendLink = path.join(root, 'Backend alias');
    fs.symlinkSync(backend, backendLink, 'dir');
    const project = normalizeProject({ id: 'mixed-fixture', name: 'Review workspace', externalEditor: { preferredEditorId: 'islet' }, tabs: [
      { host: '__local__', currentPath: backend, manualTitle: 'Backend' },
      { host: '__local__', currentPath: backendLink, manualTitle: 'Duplicate local' },
      { host: 'review-host', currentPath: '/srv/Front end & worker', manualTitle: 'Remote frontend', password: 'fixture-not-for-export' },
      { host: 'another-host', currentPath: '/srv/Front end & worker', manualTitle: 'Remote worker' },
      { host: 'review-host', currentPath: '/srv/Front end & worker', manualTitle: 'Duplicate' }
    ] });
    const folders = await resolveFolders(project, { allowRemote: true });
    assert.equal(folders.length, 3);
    assert.deepEqual(folders.map(item => item.hostId), ['local', 'ssh:review-host', 'ssh:another-host']);
    const opts = { root: path.join(root, 'workspaces'), editor, project, folders };
    const workspace = await prepareWorkspace(opts);
    assert(workspace.target.endsWith('.islet-workspace'));
    const manifest = JSON.parse(fs.readFileSync(workspace.target, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.name, project.name);
    assert.deepEqual(manifest.roots.map(item => item.label), ['Backend', 'Remote frontend', 'Remote worker']);
    assert.equal(new Set(manifest.roots.map(item => item.id)).size, 3);
    assert.equal(JSON.stringify(manifest).includes('fixture-not-for-export'), false);
    manifest.preferences = { fixture: true };
    fs.writeFileSync(workspace.target, JSON.stringify(manifest));
    await prepareWorkspace({ ...opts, folders: folders.slice(0, 2) });
    const updated = JSON.parse(fs.readFileSync(workspace.target));
    assert.deepEqual(updated.preferences, { fixture: true });
    assert.equal(updated.id, manifest.id);
    updated.roots.reverse();
    fs.writeFileSync(workspace.target, JSON.stringify(updated));
    await assert.rejects(prepareWorkspace(opts), error => error.code === 'WORKSPACE_CONFLICT' && error.canUseExisting);
    assert.equal((await prepareWorkspace({ ...opts, useExisting: true })).target, workspace.target);
    fs.writeFileSync(workspace.target, 'null');
    await assert.rejects(prepareWorkspace(opts), error => error.code === 'WORKSPACE_CONFLICT' && error.canUseExisting);
    await assert.rejects(resolveFolders(project), error => error.code === 'REMOTE_UNSUPPORTED');
    await assert.rejects(resolveFolders({ tabs: [{ host: '-bad', initialPath: '/srv/code' }] }, { allowRemote: true }), error => error.code === 'MISSING_FOLDERS');
    await assert.rejects(resolveFolders({ tabs: [{ host: 'review-host', initialPath: 'relative' }] }, { allowRemote: true }), error => error.code === 'MISSING_FOLDERS');
    for (const host of ['review\nhost', 'review\0host']) {
      await assert.rejects(resolveFolders({ tabs: [{ host, initialPath: '/srv/code' }] }, { allowRemote: true }), error => error.code === 'MISSING_FOLDERS');
    }
    validateSettings({ editor: { externalEditors: { defaultEditorId: { value: 'islet' }, overrides: { value: { islet: app } } } } });

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.editor.externalEditors.overrides.value = { islet: app };
    const service = createExternalEditors({ getSettings: () => settings, getState: () => ({}), library: { read: () => [project] }, root: path.join(root, 'launch-workspaces'), discovery, launch: launchProcess });
    const result = await service.open({ savedProjectId: project.id });
    const launched = JSON.parse(fs.readFileSync(recording));
    assert.deepEqual(launched.args, ['open', '--new-window', '--workspace', result.workspacePath]);
    assert.equal(launched.app, app);
    assert.equal(result.folderCount, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.workspacePath)).roots.map(item => item.hostId), ['local', 'ssh:review-host', 'ssh:another-host']);

    // Optional cross-application contract check uses an explicitly supplied checkout.
    if (process.env.ISLET_SOURCE_ROOT) {
      const source = path.resolve(process.env.ISLET_SOURCE_ROOT);
      const { parseArgs } = await import(pathToFileURL(path.join(source, 'scripts/islet.mjs')).href);
      const parsed = parseArgs([...launched.args]);
      assert.equal(parsed.workspace, result.workspacePath);
      assert.equal(parsed.newWindow, true);
      const { Engine } = await import(pathToFileURL(path.join(source, 'remote-helper/engine.mjs')).href);
      const host = new Engine({ dataDir: path.join(root, 'islet-data') });
      try {
        const loaded = await host.request('workspace.load', { path: parsed.workspace });
        assert.deepEqual(loaded.roots, JSON.parse(fs.readFileSync(result.workspacePath)).roots);
      } finally { await host.close(); }
    }
    fs.rmSync(native);
    await assert.rejects(service.open({ savedProjectId: project.id }), error => error.code === 'INVALID_EDITOR_PATH');
    console.log('PASS: Islet app/CLI discovery, custom paths, mixed SSH/local workspace identity, ordering, credential exclusion, conflicts, launch arguments and missing app');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
