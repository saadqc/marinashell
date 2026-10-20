const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createInterpreterHandoff } = require('../main/services/externalEditors/interpreters');
const { prepareWorkspace } = require('../main/services/externalEditors/workspaces');
const { createExternalEditors } = require('../main/services/externalEditors');
const { DEFAULT_SETTINGS } = require('../main/constants');
const { normalizeDefaults } = require('../plugins/run-configurations/configuration');

(async () => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'islet-python-')));
  try {
    const local = path.join(temp, 'backend'), nested = path.join(local, 'worker');
    await fs.mkdir(nested, { recursive: true });
    const python = path.join(temp, 'Python env/bin/python'), nextPython = path.join(temp, 'Other env/bin/python');
    for (const file of [python, nextPython]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '#!/bin/sh\nexit 99\n', { mode: 0o700 }); }
    const folders = [{ name: 'Backend', path: local, hostId: 'local' }, { name: 'Remote', path: '/srv/code', hostId: 'ssh:review-host' }];
    const project = { id: 'fixture', name: 'Review', tabs: [], configurationIds: ['local', 'remote', 'js'] };
    let configs = [
      { id: 'local', type: 'python', host: '__local__', cwd: local, interpreter: python, env: { PRIVATE_VALUE: 'never-export' }, setupScripts: ['never-run.sh'] },
      { id: 'remote', type: 'python', host: 'review-host', cwd: '/srv/code', interpreter: '/opt/env/bin/python' },
      { id: 'js', type: 'javascript', host: '__local__', cwd: local, interpreter: '/opt/node' },
      { id: 'unlinked', type: 'python', host: '__local__', cwd: local, interpreter: nextPython }
    ];
    let defaults = [], queries = [];
    const command = async (host, text, options) => {
      queries.push({ host, text }); assert.equal(options.timeoutMs, 10000);
      assert(!text.includes('never-run') && !text.includes('never-export') && !text.includes(' run ') && !text.includes(' install '));
      if (text.includes('env list --json')) return JSON.stringify({ envs: ['/opt/envs/review'] });
      if (text.includes(' prefix ')) return '/opt/pyenv/versions/review';
      if (text.includes('command -v')) {
        if (text.includes('/opt/envs/review/bin/python')) return '/opt/envs/review/bin/python';
        if (text.includes('/opt/pyenv/versions/review/bin/python')) return '/opt/pyenv/versions/review/bin/python';
        return '/opt/env/bin/python';
      }
      throw new Error('Unexpected query');
    };
    const handoff = createInterpreterHandoff({ getConfigurations: () => configs, getDefaults: () => defaults, command });
    const resolve = () => handoff(project, folders, ['fixture', 'live-fixture']);
    let resolver = await resolve();
    assert.equal(await resolver(folders[0]), python);
    assert.equal(await resolver(folders[1]), '/opt/env/bin/python');
    assert(queries.every(q => q.host === 'review-host'));
    const options = { root: path.join(temp, 'workspaces'), editor: { id: 'islet', family: 'islet' }, project, folders, resolveInterpreter: resolver };
    const result = await prepareWorkspace(options);
    const read = async () => JSON.parse(await fs.readFile(result.target, 'utf8'));
    let workspace = await read();
    assert.deepEqual(workspace.roots.map(r => r.interpreter), [python, '/opt/env/bin/python']);
    assert(!JSON.stringify(workspace).includes('never-export'));
    configs[0].interpreter = nextPython;
    await prepareWorkspace({ ...options, resolveInterpreter: await resolve() });
    assert.equal((await read()).roots[0].interpreter, nextPython);
    workspace = await read(); workspace.roots[0] = { state: 'ready', customPreference: true, ...workspace.roots[0], interpreter: '/chosen/manually/python' }; workspace.preferences = { fontSize: 15 };
    await fs.writeFile(result.target, JSON.stringify(workspace));
    configs.push({ ...configs[0], id: 'conflict', interpreter: python }); project.configurationIds.push('conflict');
    resolver = await resolve();
    await assert.rejects(resolver(folders[0]), e => e.code === 'INTERPRETER_CONFLICT');
    await prepareWorkspace({ ...options, resolveInterpreter: resolver });
    assert.equal((await read()).roots[0].interpreter, '/chosen/manually/python');
    assert.deepEqual((await read()).preferences, { fontSize: 15 });
    assert.equal((await read()).roots[0].customPreference, true);
    workspace = await read(); delete workspace.roots[0].interpreter;
    await fs.writeFile(result.target, JSON.stringify(workspace));
    await prepareWorkspace({ ...options, resolveInterpreter: await resolve() });
    assert.equal((await read()).roots[0].interpreter, '');
    await prepareWorkspace({ ...options, resolveInterpreter: await resolve() });
    assert.equal((await read()).roots[0].interpreter, '');

    configs = [{ id: 'local', type: 'python', host: '__local__', cwd: nested, interpreter: python }];
    const nestedFolders = [...folders, { name: 'Worker', path: nested, hostId: 'local' }];
    resolver = await handoff(project, nestedFolders);
    assert.equal(await resolver(folders[0]), undefined);
    assert.equal(await resolver(nestedFolders[2]), python);
    configs[0].expiresAt = new Date(0).toISOString();
    assert.equal(await (await handoff(project, nestedFolders))(nestedFolders[2]), undefined);

    configs = [];
    defaults = [{ id: 'live-fixture', host: '__local__', type: 'python', cwd: local, interpreter: python }];
    resolver = await resolve(); assert.equal(await resolver(folders[0]), python); assert.equal(await resolver(folders[1]), undefined);
    delete defaults[0].host;
    await assert.rejects((await resolve())(folders[0]), e => e.code === 'INTERPRETER_CONFLICT');
    assert.equal(await (await handoff(project, [folders[0]], ['live-fixture']))(folders[0]), python);
    defaults[0].type = 'javascript'; assert.equal(await (await resolve())(folders[0]), undefined);
    defaults = [];
    for (const manager of ['conda', 'mamba', 'micromamba', 'pyenv']) {
      configs = [{ id: 'remote', type: 'python', host: 'review-host', cwd: '/srv/code', manager, managerPath: `/opt/Tools with spaces/${manager}`, environment: 'review', interpreter: 'python' }];
      const expected = manager === 'pyenv' ? '/opt/pyenv/versions/review/bin/python' : '/opt/envs/review/bin/python';
      assert.equal(await (await resolve())(folders[1]), expected);
    }
    configs[0] = { ...configs[0], manager: 'system', setupScripts: ['activate.sh'], envFiles: ['private.env'] };
    const before = queries.length;
    await assert.rejects((await resolve())(folders[1]), e => e.code === 'INTERPRETER_UNRESOLVED' && !e.message.includes('private.env'));
    assert.equal(queries.length, before);
    configs[0] = { ...configs[0], setupScripts: [], envFiles: [], interpreter: 'python' };
    assert.equal(await (await resolve())(folders[1]), '/opt/env/bin/python');
    const broken = createInterpreterHandoff({ getConfigurations: () => configs, command: async () => { throw new Error('private manager output'); } });
    await assert.rejects((await broken(project, folders))(folders[1]), e => e.code === 'INTERPRETER_UNRESOLVED' && !e.message.includes('private manager output'));
    assert.deepEqual({ ...normalizeDefaults({ host: 'review-host', type: 'python' }) }.host, 'review-host');
    assert.equal(normalizeDefaults({ type: 'python' }).type, 'python');
    // Alias selections in one environment are equivalent; distinct environments remain conflicts.
    const alias = path.join(path.dirname(python), 'python3'); await fs.symlink(python, alias);
    configs = [{ id: 'local', type: 'python', host: '__local__', cwd: local, interpreter: python }, { id: 'conflict', type: 'python', host: '__local__', cwd: local, interpreter: alias }];
    assert.equal(await (await resolve())(folders[0]), python);
    const separateEnv = path.join(temp, 'Separate env/bin/python'); await fs.mkdir(path.dirname(separateEnv), { recursive: true }); await fs.symlink(python, separateEnv);
    configs[1].interpreter = separateEnv;
    await assert.rejects((await resolve())(folders[0]), e => e.code === 'INTERPRETER_CONFLICT');
    configs = [{ id: 'remote', type: 'python', host: 'review-host', cwd: '/srv/code', interpreter: '-unsafe' }];
    const queryCount = queries.length;
    await assert.rejects((await resolve())(folders[1]), e => e.code === 'INTERPRETER_UNRESOLVED');
    assert.equal(queries.length, queryCount);
    configs = [{ id: 'local', type: 'python', host: '__local__', cwd: local, interpreter: python }, { id: 'unlinked', type: 'python', host: '__local__', cwd: local, interpreter: nextPython }];
    const saved = { id: 'saved-project', name: 'Saved fixture', tabs: [{ host: '__local__', currentPath: local, manualTitle: 'Backend' }] };
    const state = { tabGroups: [{ id: 'live-group', savedGroupId: saved.id, configurationIds: ['local'] }], tabs: [] };
    const settings = structuredClone(DEFAULT_SETTINGS); settings.editor.externalEditors.defaultEditorId.value = 'islet';
    let launches = 0;
    const service = createExternalEditors({ getState: () => state, getSettings: () => settings, library: { read: () => [saved] }, root: path.join(temp, 'service-workspaces'), interpreterHandoff: handoff,
      discovery: { list: async () => [{ id: 'islet', path: '/fixture/islet' }], resolve: async () => ({ executable: '/fixture/islet' }) }, launch: async () => { launches++; } });
    const opened = await service.open({ projectId: 'live-group' });
    assert.equal(JSON.parse(await fs.readFile(opened.workspacePath)).roots[0].interpreter, python);
    configs = []; defaults = [{ id: 'live-group', host: '__local__', type: 'python', cwd: local, interpreter: nextPython }];
    const reopened = await service.open({ savedProjectId: saved.id });
    assert.equal(JSON.parse(await fs.readFile(reopened.workspacePath)).roots[0].interpreter, nextPython);
    assert.equal(launches, 2);
    defaults = [];
    await service.open({ savedProjectId: saved.id });
    assert.equal(JSON.parse(await fs.readFile(reopened.workspacePath)).roots[0].interpreter, '');
    defaults = [{ id: 'live-group', host: '__local__', type: 'python', cwd: local, interpreter: nextPython }];
    await service.open({ savedProjectId: saved.id });
    assert.equal(JSON.parse(await fs.readFile(reopened.workspacePath)).roots[0].interpreter, nextPython);
    // Exercise the generated queries in a real bounded shell using disposable manager tools.
    const { promisify } = require('util');
    const exec = promisify(require('child_process').execFile);
    const tools = path.join(temp, 'tools'), prefix = path.join(temp, 'environments/review');
    await fs.mkdir(tools); await fs.mkdir(path.join(prefix, 'bin'), { recursive: true });
    await fs.symlink(python, path.join(prefix, 'bin/python'));
    await fs.writeFile(path.join(tools, 'conda'), `#!/bin/sh\n[ \"$1 $2\" = \"env list\" ] || exit 98\nprintf '%s' '${JSON.stringify({ envs: [prefix] })}'\n`, { mode: 0o700 });
    await fs.writeFile(path.join(tools, 'pyenv'), `#!/bin/sh\n[ \"$1\" = prefix ] || exit 98\nprintf '%s' '${prefix}'\n`, { mode: 0o700 });
    const actual = createInterpreterHandoff({ getConfigurations: () => configs, command: async (host, text, options) => {
      assert.equal(host, '__local__');
      return (await exec('/bin/bash', ['-c', text], { timeout: options.timeoutMs, env: { PATH: tools + ':/usr/bin:/bin', HOME: temp } })).stdout;
    } });
    configs = [{ id: 'local', type: 'python', host: '__local__', cwd: local, interpreter: 'python', manager: 'conda', managerPath: path.join(temp, 'stale/conda'), environment: 'review' }];
    assert.equal(await (await actual(project, folders))(folders[0]), path.join(prefix, 'bin/python'));
    configs[0].environment = '~/environments/review';
    assert.equal(await (await actual(project, folders))(folders[0]), path.join(prefix, 'bin/python'));
    configs[0] = { ...configs[0], manager: 'pyenv', managerPath: path.join(tools, 'pyenv'), environment: 'review' };
    assert.equal(await (await actual(project, folders))(folders[0]), path.join(prefix, 'bin/python'));
    await fs.mkdir(path.join(local, '.venv/bin'), { recursive: true }); await fs.symlink(python, path.join(local, '.venv/bin/python'));
    configs[0] = { ...configs[0], manager: 'system', interpreter: '.venv/bin/python' };
    assert.equal(await (await actual(project, folders))(folders[0]), path.join(local, '.venv/bin/python'));
    configs = [];
    if (process.env.ISLET_SOURCE_ROOT) {
      const { pathToFileURL } = require('url');
      const { Engine } = await import(pathToFileURL(path.join(process.env.ISLET_SOURCE_ROOT, 'remote-helper/engine.mjs')).href);
      const engine = new Engine({ dataDir: path.join(temp, 'engine-data') });
      try {
        const value = await engine.request('workspace.load', { path: reopened.workspacePath });
        value.roots[0] = await engine.request('root.open', { ...value.roots[0], interpreter: python });
        await engine.request('workspace.save', { path: reopened.workspacePath, value });
        await service.open({ savedProjectId: saved.id });
        const regenerated = JSON.parse(await fs.readFile(reopened.workspacePath));
        assert.equal(regenerated.roots[0].state, 'ready');
        assert.equal(regenerated.roots[0].interpreter, python);
      } finally { await engine.close(); }
    }
    console.log('PASS: Islet Python host/root scoping, defaults, managed refresh, custom choices, conflicts, manager resolution, expiry and private setup exclusion');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
