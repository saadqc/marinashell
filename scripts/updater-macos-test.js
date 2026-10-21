'use strict';
// Rehearse with isolated ad-hoc signed Electron bundles. Never installs into Applications.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const tar = require('tar');
const { prepareMacUpdate, validateBundle } = require('../main/services/updater/mac');
const { hashFile } = require('../main/services/updater/security');
const config = require('../main/services/updater/config');
const run = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 90000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await predicate(); if (value) return value; await pause(100); } throw new Error(label); }
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') { console.log('SKIP: native updater rehearsal requires Apple silicon macOS'); return; }
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marina-update-native-')));
  const electronApp = path.resolve(require('electron'), '../../..');
  const fixtures = [];
  async function fixture(directory, version, fail = false) {
    const bundle = path.join(directory, config.appName); await fs.mkdir(directory, { recursive: true });
    await run('/usr/bin/ditto', [electronApp, bundle]);
    const plist = path.join(bundle, 'Contents/Info.plist');
    for (const [key, value] of [['CFBundleIdentifier', config.appId], ['CFBundleShortVersionString', version], ['CFBundleVersion', version]]) await run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    const application = path.join(bundle, 'Contents/Resources/app'); await fs.mkdir(application, { recursive: true });
    await fs.writeFile(path.join(application, 'package.json'), JSON.stringify({ name: 'updater-rehearsal', version, main: 'main.js' }));
    const marker = path.join(root, `started-${version}${fail ? '-failed' : ''}.json`);
    await fs.writeFile(path.join(application, 'main.js'), `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(root, 'data-' + version))});app.whenReady().then(async()=>{if(${fail}){app.exit(7);return}const window=new BrowserWindow({show:false});await window.loadURL('data:text/html,Update%20rehearsal');if(process.env.MARINASHELL_UPDATE_ACK)fs.writeFileSync(process.env.MARINASHELL_UPDATE_ACK,JSON.stringify({nonce:process.env.MARINASHELL_UPDATE_NONCE,version:app.getVersion()}));fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,version:app.getVersion()}));setTimeout(()=>app.exit(0),1500)});`);
    await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { timeout: 60000 }); await validateBundle(bundle, config, version);
    fixtures.push(bundle); return { bundle, marker };
  }
  try {
    const current = await fixture(path.join(root, 'installed'), '1.0.0');
    async function install(version, fail) {
      const next = await fixture(path.join(root, 'source-' + version), version, fail);
      const archive = path.join(root, `${version}.tar.gz`); await tar.c({ cwd: path.dirname(next.bundle), file: archive, gzip: true, portable: true }, [config.appName]);
      const cache = path.join(root, 'cache-' + version); await fs.mkdir(cache, { mode: 0o700 });
      const transaction = await prepareMacUpdate({ archive, artifact: await hashFile(archive), manifest: { version }, config, appPath: path.join(current.bundle, 'Contents/MacOS/Electron'), cache, execPath: path.join(current.bundle, 'Contents/MacOS/Electron') });
      // Model the old application's completed normal shutdown with an exited child PID.
      const stopped = spawn('/usr/bin/true'); await new Promise(resolve => stopped.on('exit', resolve)); transaction.record.parentPid = stopped.pid;
      await fs.writeFile(path.join(cache, 'install.json'), JSON.stringify(transaction.record));
      await transaction.launch();
      if (!fail) {
        await waitFor(async () => (await fs.readFile(next.marker, 'utf8').then(JSON.parse).catch(() => null))?.version === version, 'Updated Electron app did not launch');
        await waitFor(async () => !await fs.stat(transaction.record.lock).catch(() => null), 'Installer lock did not clear');
        await validateBundle(current.bundle, config, version);
      } else {
        await waitFor(async () => (await fs.readFile(transaction.record.receipt, 'utf8').then(JSON.parse).catch(() => null))?.ok === false, 'Failed startup did not roll back');
        await validateBundle(current.bundle, config, '1.2.0');
      }
      await pause(2000);
    }
    await install('1.2.0', false); await install('1.3.0', true);
    console.log('PASS real ad-hoc signed Electron archive extraction, detached helper, atomic replacement, startup acknowledgement and failed-launch rollback');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
