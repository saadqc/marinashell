'use strict';
// Launch only a temporary instrumented copy with isolated settings and HOME.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
async function main() {
  if (process.platform !== 'darwin') return;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'marina-package-smoke-')));
  const version = require('../package.json').version;
  try {
    const app = path.join(root, 'MarinaShell.app');
    await run('/usr/bin/ditto', [path.resolve(`release/MarinaShell-${version}/mac-arm64/MarinaShell.app`), app]);
    const resources = path.join(app, 'Contents/Resources/app');
    const metadata = JSON.parse(await fs.readFile(path.join(resources, 'package.json'), 'utf8'));
    const originalMain = metadata.main; metadata.main = 'updater-smoke.cjs';
    await fs.writeFile(path.join(resources, 'package.json'), JSON.stringify(metadata));
    const receipt = path.join(root, 'receipt.json');
    await fs.writeFile(path.join(resources, metadata.main), `
const {app,BrowserWindow}=require('electron');const fs=require('fs');const os=require('os');const assert=require('assert/strict');
const home=${JSON.stringify(root)};app.setPath('userData',home+'/data');os.homedir=()=>home;process.env.HOME=home;
setTimeout(()=>{console.error('Packaged startup timed out');app.exit(1)},30000).unref();
const terminal=require('node-pty').spawn('/bin/sh',['-c','printf packaged-native-ok'],{cwd:home,env:{HOME:home,PATH:'/usr/bin:/bin'}});let output='';terminal.onData(data=>output+=data);terminal.onExit(()=>{
try{assert(output.includes('packaged-native-ok'));require(${JSON.stringify('./' + originalMain)});app.whenReady().then(async()=>{
const window=BrowserWindow.getAllWindows()[0];if(!window)throw Error('No packaged application window');
if(window.webContents.isLoading())await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
const result=await window.webContents.executeJavaScript('Boolean(document.querySelector("#sidebar"))');assert(result);
fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({version:app.getVersion(),nativeTerminal:true,applicationWindow:true,privateHome:os.homedir()}));app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})}catch(error){console.error(error);app.exit(1)}});
`);
    await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { timeout: 60000 });
    const env = { ...process.env, HOME: root }; delete env.ELECTRON_RUN_AS_NODE;
    await run(path.join(app, 'Contents/MacOS/MarinaShell'), [], { env, timeout: 45000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(await fs.readFile(receipt, 'utf8'));
    require('node:assert/strict').deepEqual(result, { version, nativeTerminal: true, applicationWindow: true, privateHome: root });
    console.log('PASS: unpacked packaged application cold launch, real native PTY, rendered shell and isolated settings');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
