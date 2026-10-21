'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { UpdateService } = require('./service');
const { prepareMacUpdate } = require('./mac');
const config = require('./config');
function registerUpdater({ app, ipcMain, dialog, shell, getWindows, getMainWindow }) {
  const cache = path.join(app.getPath('userData'), 'updates');
  let guard = null;
  const trusted = event => getWindows().some(window => window && !window.isDestroyed() && window.webContents.id === event.sender.id);
  ipcMain.on('updates:startup-ready', event => { if (event.sender.id === getMainWindow()?.webContents.id) acknowledgeUpdate(app).catch(() => {}); });
  const unlock = () => { getMainWindow()?.webContents.send('updates:unlock'); };
  ipcMain.on('updates:prepared', (event, value) => {
    if (!guard || event.sender.id !== guard.sender || value?.id !== guard.id) return;
    clearTimeout(guard.timer); const resolve = guard.resolve; guard = null; resolve(value);
  });
  async function prepareRestart() {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.isLoading()) throw new Error('Open the workspace and let it finish loading before restarting.');
    const result = await new Promise(resolve => {
      const id = crypto.randomUUID();
      guard = { id, sender: window.webContents.id, resolve, timer: setTimeout(() => { guard = null; resolve({ ok: false, error: 'Workspace did not confirm it was safe to restart.' }); }, 15000) };
      window.webContents.send('updates:prepare', { id });
    });
    if (!result.ok) { unlock(); throw new Error(result.error || 'Save your open files before restarting.'); }
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', title: 'Restart to update MarinaShell?', message: `MarinaShell ${service.state.version} is ready to install.`,
      detail: result.connected ? 'Open terminal connections will close. Commands running in ordinary terminal sessions may stop. Save any work in terminal programs before restarting.' : 'Your saved workspace will reopen after the update.',
      buttons: ['Restart and Update', 'Later'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (response !== 0) { unlock(); return false; }
    return true;
  }
  const service = new UpdateService({ version: app.getVersion(), cache, packaged: app.isPackaged, prepareRestart,
    async openInstaller(file, kind) {
      if (kind === "appimage") { await fs.chmod(file, 0o700); shell.showItemInFolder(file); return; }
      const { response } = await dialog.showMessageBox({ type: 'question', title: 'Install MarinaShell update', message: 'The verified installer is ready.', detail: 'This platform uses its installer to finish the update. Save your work before continuing.', buttons: ['Open Installer', 'Later'], defaultId: 1, cancelId: 1 });
      if (response === 0) { const error = await shell.openPath(file); if (error) throw new Error(error); }
    },
    async install(pending) {
      let transaction;
      try {
        transaction = await prepareMacUpdate({ archive: pending.file, artifact: pending.artifact, manifest: pending.manifest, config, appPath: process.execPath, cache: pending.directory });
        await transaction.launch();
        app.quit();
        // A close guard may veto the quit. Never replace a still-running app.
        const timer = setTimeout(async () => { await transaction.cancel().catch(() => {}); unlock(); service.set({ status: 'ready', error: 'The application did not close. Finish pending work and try again.' }); }, 15000); timer.unref();
      } catch (error) { if (transaction) await transaction.cancel().catch(() => {}); unlock(); throw error; }
    }
  });
  for (const [channel, handler] of Object.entries({ 'updates:get': () => service.snapshot(), 'updates:check': () => service.check(), 'updates:download': () => service.update(), 'updates:restart': () => service.restart(), 'updates:configure': value => service.configure(value) })) {
    ipcMain.handle(channel, (event, value) => { if (!trusted(event)) throw new Error('Untrusted update request.'); return handler(value); });
  }
  service.on('change', value => { for (const window of getWindows()) if (window && !window.isDestroyed()) window.webContents.send('updates:state', value); });
  service.init().catch(error => service.set({ status: 'error', error: error.message }));
  return service;
}
async function acknowledgeUpdate(app) {
  const ack = process.env.MARINASHELL_UPDATE_ACK, nonce = process.env.MARINASHELL_UPDATE_NONCE;
  delete process.env.MARINASHELL_UPDATE_ACK; delete process.env.MARINASHELL_UPDATE_NONCE;
  if (!ack || !/^[a-f0-9]{48}$/.test(nonce || '') || path.basename(ack) !== 'ack.json' || !path.basename(path.dirname(ack)).startsWith('.marinashell-update-')) return;
  const directory = await fs.lstat(path.dirname(ack)).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.()) return;
  await fs.writeFile(ack, JSON.stringify({ nonce, version: app.getVersion() }), { mode: 0o600 });
}
module.exports = { registerUpdater, acknowledgeUpdate };
