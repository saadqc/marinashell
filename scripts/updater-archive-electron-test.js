'use strict';
// Exercise extraction in Electron's browser process, where fs is ASAR-aware.
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const physical = process.versions.electron ? require('original-fs') : require('node:fs');
const fs = physical.promises;
const tar = require('tar');
const config = require('../main/services/updater/config');
const { extractArchive, validateBundle } = require('../main/services/updater/mac');
const rootAt = process.argv.indexOf('--fixture-root');
async function child(root) {
  const release = process.argv.includes('--release');
  const archives = release ? [process.env.UPDATER_TEST_ARCHIVE || path.resolve('release/updater', `MarinaShell-${require('../package.json').version}-darwin-arm64.app.tar.gz`)] : [path.join(root, 'packed.tar.gz'), path.join(root, 'unpacked.tar.gz')];
  for (let i = 0; i < archives.length; i++) {
    const out = path.join(root, `fixed-${i}`); await fs.mkdir(out);
    const bundle = await extractArchive(archives[i], out, config);
    if (release) {
      await validateBundle(bundle, config, require('../package.json').version);
      assert.equal(await fs.stat(path.join(bundle, 'Contents/Resources/app.asar')).catch(() => null), null, 'Bridge must have no app.asar');
      // This is the exact failing operation in the original updater. The local
      // qualification can also load its complete original implementation.
      const oldOut = path.join(root, 'legacy'); await fs.mkdir(oldOut);
      if (process.env.LEGACY_MAC_SOURCE) {
        const Module = require('node:module');
        const childProcess = require('node:child_process');
        const spawn = childProcess.spawn;
        childProcess.spawn = (file, args, options) => {
          if (args?.[0]?.endsWith('install.cjs')) {
            const log = physical.openSync(path.join(root, 'helper.log'), 'a');
            const result = spawn(file, args, { ...options, stdio: ['ignore', log, log] }); physical.closeSync(log);
            result.on('exit', (code, signal) => console.log('Legacy helper exit', code, signal)); return result;
          }
          return spawn(file, args, options);
        };
        const filename = process.env.LEGACY_APP_TEST_COPY ? path.join(process.env.LEGACY_APP_TEST_COPY, 'Contents/Resources/app.asar/main/services/updater/mac.js') : path.resolve('main/services/updater/legacy-test.cjs');
        const legacy = new Module(filename); legacy.filename = filename; legacy.paths = Module._nodeModulePaths(path.dirname(filename));
        legacy._compile(await fs.readFile(process.env.LEGACY_MAC_SOURCE, 'utf8'), filename);
        childProcess.spawn = spawn;
        await legacy.exports.extractArchive(archives[i], oldOut, config);
        if (process.env.LEGACY_APP_TEST_COPY) {
          const cache = path.join(root, 'legacy-cache'); await fs.mkdir(cache);
          const { hashFile } = require('../main/services/updater/security');
          const transaction = await legacy.exports.prepareMacUpdate({ archive: archives[i], artifact: await hashFile(archives[i]), manifest: { version: require('../package.json').version }, config, appPath: path.join(process.env.LEGACY_APP_TEST_COPY, 'Contents/MacOS/MarinaShell'), cache, execPath: path.join(process.env.LEGACY_APP_TEST_COPY, 'Contents/MacOS/MarinaShell') });
          const helperPath = path.join(cache, 'install.cjs');
          const helperSource = await fs.readFile(helperPath, 'utf8');
          assert.equal(helperSource, await fs.readFile(path.resolve('main/services/updater/install-helper.js'), 'utf8'));
          try { await transaction.launch(); }
          catch (error) { await transaction.cancel(); console.error('Legacy helper log:', await fs.readFile(path.join(root, 'helper.log'), 'utf8').catch(() => 'unavailable')); throw error; }
          await transaction.cancel();
          for (let n = 0; n < 100 && await fs.stat(transaction.record.lock).catch(() => null); n++) await new Promise(resolve => setTimeout(resolve, 50));
          assert.equal(await fs.stat(transaction.record.lock).catch(() => null), null);
          assert(await fs.stat(process.env.LEGACY_APP_TEST_COPY), 'Preparation must not replace the temporary host app');
          console.log('PASS: exact installed legacy prepareMacUpdate, helper copy from ASAR, detached helper ready/cancel on a temporary app');
        }
      } else await tar.x({ file: archives[i], cwd: oldOut, strict: true, preservePaths: false, noChmod: false });
      await validateBundle(path.join(oldOut, config.appName), config, require('../package.json').version);
      console.log('PASS: actual signed bridge archive extracts with legacy tar.x inside Electron');
    } else {
      const resources = path.join(bundle, 'Contents/Resources');
      if (i === 0) assert.deepEqual(await fs.readFile(path.join(resources, 'app.asar')), await fs.readFile(path.join(root, 'packed/MarinaShell.app/Contents/Resources/app.asar')));
      else assert.equal(JSON.parse(await fs.readFile(path.join(resources, 'app/package.json'))).name, 'fixture');
    }
  }
  console.log('PASS: physical packed and unpacked bundle extraction inside Electron; no global noAsar mutation');
  assert.notEqual(process.noAsar, true);
}
async function parent() {
  if (process.platform !== 'darwin') { console.log('SKIP: macOS Electron extraction regression'); return; }
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marina-electron-archive-')));
  try {
    if (!process.argv.includes('--release')) {
      const asar = require('@electron/asar');
      const app = path.join(root, 'unpacked/MarinaShell.app/Contents/Resources/app'); await fs.mkdir(app, { recursive: true });
      await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'fixture', main: 'main.js' }));
      await fs.writeFile(path.join(app, 'main.js'), 'module.exports = 42;');
      const resources = path.join(root, 'packed/MarinaShell.app/Contents/Resources'); await fs.mkdir(resources, { recursive: true });
      await asar.createPackage(app, path.join(resources, 'app.asar'));
      for (const name of ['packed', 'unpacked']) await tar.c({ file: path.join(root, name + '.tar.gz'), cwd: path.join(root, name), gzip: true }, [config.appName]);
    }
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { promisify } = require('node:util'); const exec = promisify(require('node:child_process').execFile);
    if (process.argv.includes('--release') && env.LEGACY_APP_BUNDLE) {
      env.LEGACY_APP_TEST_COPY = path.join(root, 'legacy-host/MarinaShell.app');
      await fs.mkdir(path.dirname(env.LEGACY_APP_TEST_COPY));
      await exec('/usr/bin/ditto', [env.LEGACY_APP_BUNDLE, env.LEGACY_APP_TEST_COPY]);
      // The installed host is already running. Warm the copied executable so
      // first-launch OS checks do not consume its five-second helper deadline.
      const warm = await exec(path.join(env.LEGACY_APP_TEST_COPY, 'Contents/MacOS/MarinaShell'), ['-e', 'process.stdout.write("legacy-node-ready")'], { env: { ...env, HOME: root, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60000 });
      assert.equal(warm.stdout, 'legacy-node-ready');
    }
    const result = await exec(require('electron'), [__filename, '--fixture-root', root, ...(process.argv.includes('--release') ? ['--release'] : [])], { env, timeout: 120000, maxBuffer: 1024 * 1024 });
    process.stdout.write(result.stdout);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
if (process.versions.electron && rootAt >= 0) {
  const { app } = require('electron');
  app.setPath('userData', path.join(process.argv[rootAt + 1], 'electron-data'));
  app.whenReady().then(() => child(process.argv[rootAt + 1])).catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => app.exit(process.exitCode || 0));
} else parent().catch(error => { console.error(error); process.exitCode = 1; });
